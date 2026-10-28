-- Cooper: atualiza um servidor do esquema 13 para o 16 (anexos, subtarefas/comentários/prioridade, resumo do contexto).
-- Cole no SQL Editor do Supabase e clique em Run. Gerado a partir de supabase/migrations/20261028000014..16.

-- ===== 20261028000014_task_attachments.sql =====
-- Cooper — anexos nas tarefas.
-- O arquivo fica no Supabase Storage (bucket privado task-files), não no banco: a tabela guarda só metadados.
-- Caminho no bucket: {workspace_id}/{task_id}/{id}-{nome}. Limites: 10 MB por arquivo, 20 anexos por tarefa.
-- Quem é membro vê e baixa; quem enviou, quem criou a tarefa ou o dono do projeto apaga.
-- A parte do Storage só roda onde o schema storage existe (Supabase); os testes locais cobrem a tabela.
-- Coberto por tests/sql/attachments.test.ts.

create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  path text not null unique check (char_length(path) <= 400),
  name text not null check (char_length(name) between 1 and 200),
  size_bytes bigint not null check (size_bytes between 0 and 10485760),
  mime text check (char_length(mime) <= 120),
  uploaded_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index on public.task_attachments (task_id, created_at);
alter table public.task_attachments enable row level security;

create function public.guard_task_attachment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = new.task_id;
  if not found or t.workspace_id <> new.workspace_id then
    raise exception 'tarefa não encontrada neste workspace' using errcode = 'P0002';
  end if;
  if new.path not like new.workspace_id::text || '/' || new.task_id::text || '/%' then
    raise exception 'caminho do anexo fora da pasta da tarefa' using errcode = '22023';
  end if;
  if (select count(*) from public.task_attachments where task_id = new.task_id) >= 20 then
    raise exception 'limite de 20 anexos por tarefa' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger before_task_attachment_insert before insert on public.task_attachments
  for each row execute function public.guard_task_attachment();
revoke execute on function public.guard_task_attachment() from public, anon, authenticated;

create policy "membros veem anexos" on public.task_attachments for select to authenticated
  using (public.is_member(workspace_id));
create policy "membros anexam" on public.task_attachments for insert to authenticated
  with check (public.is_member(workspace_id) and uploaded_by = auth.uid() and public.jwt_workspace() is null);
create policy "quem enviou, quem criou a tarefa ou o dono apaga" on public.task_attachments for delete to authenticated
  using (public.is_member(workspace_id) and (
    uploaded_by = auth.uid()
    or exists (select 1 from public.tasks t where t.id = task_id and t.created_by = auth.uid())
    or public.is_owner(workspace_id)));

-- Evento na tarefa (aparece na Atividade e no painel da tarefa).
create function public.log_task_attachment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (workspace_id, task_id, user_id, source, type, payload)
    values (new.workspace_id, new.task_id, new.uploaded_by, 'user', 'attachment_added', jsonb_build_object('name', new.name));
  else
    insert into public.task_events (workspace_id, task_id, user_id, source, type, payload)
    values (old.workspace_id, old.task_id, auth.uid(), 'user', 'attachment_removed', jsonb_build_object('name', old.name));
  end if;
  return null;
end $$;
create trigger after_task_attachment after insert or delete on public.task_attachments
  for each row execute function public.log_task_attachment();
revoke execute on function public.log_task_attachment() from public, anon, authenticated;

alter publication supabase_realtime add table public.task_attachments;

-- ───────────── Storage (só no Supabase) ─────────────
do $do$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit)
  values ('task-files', 'task-files', false, 10485760)
  on conflict (id) do update set public = false, file_size_limit = 10485760;

  -- pasta raiz = workspace: só membros leem e enviam; apagar segue a mesma regra da tabela
  execute $p$
    create policy "cooper: membros leem anexos" on storage.objects for select to authenticated
      using (bucket_id = 'task-files' and public.is_member(((storage.foldername(name))[1])::uuid))
  $p$;
  execute $p$
    create policy "cooper: membros enviam anexos" on storage.objects for insert to authenticated
      with check (bucket_id = 'task-files' and public.is_member(((storage.foldername(name))[1])::uuid))
  $p$;
  execute $p$
    create policy "cooper: apagar anexos" on storage.objects for delete to authenticated
      using (bucket_id = 'task-files' and exists (
        select 1 from public.task_attachments a
        where a.path = storage.objects.name and public.is_member(a.workspace_id) and (
          a.uploaded_by = auth.uid()
          or exists (select 1 from public.tasks t where t.id = a.task_id and t.created_by = auth.uid())
          or public.is_owner(a.workspace_id))))
  $p$;
end $do$;

create or replace function public.cooper_server_info() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('app', 'cooper', 'schema', 14)
$$;

-- ===== 20261028000015_subtasks_comments_priority.sql =====
-- Cooper — ideias de Trello/Jira/Linear (docs/PESQUISA_PLATAFORMAS.md):
-- 1. Subtarefas (um nível): a IA coordenadora divide uma tarefa grande. Quando todas as subtarefas são
--    concluídas, a tarefa-mãe vai para "Em revisão" sozinha (uma pessoa confirma; não conclui sozinha).
-- 2. Comentários na tarefa, de pessoas e de agentes (selo "declarado"), com evento para o Realtime.
-- 3. Prioridade (0 nenhuma … 4 urgente) e prazo (data), editáveis por qualquer membro, como o status.
-- Coberto por tests/sql/subtasks.test.ts.

-- ───────────── 1 e 3: colunas ─────────────
alter table public.tasks
  add column parent_id uuid references public.tasks (id) on delete set null,
  add column priority smallint not null default 0 check (priority between 0 and 4),
  add column due_on date;
create index on public.tasks (parent_id) where parent_id is not null;

create function public.guard_task_parent() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.tasks;
begin
  if new.parent_id is null or (tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id) then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'uma tarefa não pode ser subtarefa dela mesma' using errcode = '22023';
  end if;
  select * into p from public.tasks where id = new.parent_id;
  if not found or p.workspace_id <> new.workspace_id then
    raise exception 'tarefa-mãe não encontrada neste workspace' using errcode = 'P0002';
  end if;
  if p.parent_id is not null then
    raise exception 'subtarefa não pode ter subtarefas (um nível só)' using errcode = '22023';
  end if;
  if exists (select 1 from public.tasks c where c.parent_id = new.id) then
    raise exception 'esta tarefa já tem subtarefas e não pode virar subtarefa' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger before_task_parent before insert or update of parent_id on public.tasks
  for each row execute function public.guard_task_parent();

-- Todas as subtarefas concluídas → mãe em revisão (se estava em aberto).
create function public.close_parent_when_done() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.parent_id is null or new.status <> 'done' or old.status = 'done' then
    return null;
  end if;
  if not exists (select 1 from public.tasks c where c.parent_id = new.parent_id and c.status not in ('done', 'declined')) then
    update public.tasks set status = 'in_review'
    where id = new.parent_id and status in ('backlog', 'in_progress');
  end if;
  return null;
end $$;
create trigger after_subtask_done after update of status on public.tasks
  for each row execute function public.close_parent_when_done();

revoke execute on function public.guard_task_parent(), public.close_parent_when_done() from public, anon, authenticated;

-- ───────────── 2: comentários ─────────────
create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source public.event_source not null default 'user' check (source in ('user', 'agent_declared')),
  agent_session_id uuid references public.agent_sessions (id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index on public.task_comments (task_id, created_at);
alter table public.task_comments enable row level security;

create policy "membros veem comentários" on public.task_comments for select to authenticated
  using (public.is_member(workspace_id));
create policy "membros comentam" on public.task_comments for insert to authenticated
  with check (public.is_member(workspace_id) and author_id = auth.uid() and source = 'user' and agent_session_id is null
    and public.jwt_workspace() is null
    and exists (select 1 from public.tasks t where t.id = task_id and t.workspace_id = task_comments.workspace_id));
create policy "autor apaga o próprio comentário" on public.task_comments for delete to authenticated
  using (author_id = auth.uid());

create function public.log_task_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.task_events (workspace_id, task_id, user_id, agent_session_id, source, type, payload)
  values (new.workspace_id, new.task_id, new.author_id, new.agent_session_id, new.source, 'comment_added',
          jsonb_build_object('text', left(regexp_replace(new.body, '\s+', ' ', 'g'), 120)));
  return null;
end $$;
create trigger after_task_comment after insert on public.task_comments
  for each row execute function public.log_task_comment();
revoke execute on function public.log_task_comment() from public, anon, authenticated;

alter publication supabase_realtime add table public.task_comments;

-- ───────────── MCP ─────────────
create function public.mcp_add_task_comment(p_token text, p_session text, p_number integer, p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections := public.agent_auth(p_token);
  s public.agent_sessions;
  t public.tasks;
  v_text text := trim(p_text);
begin
  if v_text is null or char_length(v_text) not between 1 and 2000 then
    raise exception 'comentário deve ter de 1 a 2000 caracteres' using errcode = '22023';
  end if;
  s := public.agent_touch_session(c, p_session, 'add_task_comment');
  t := public.agent_find_task(c, p_number);
  insert into public.task_comments (workspace_id, task_id, author_id, source, agent_session_id, body)
  values (c.workspace_id, t.id, c.user_id, 'agent_declared', s.id, v_text);
  return jsonb_build_object('ok', true, 'number', t.number);
end $$;

-- Comentários e subtarefas de uma tarefa (separado do get_task_context para ele continuar curto).
create function public.mcp_get_task_discussion(p_token text, p_session text, p_number integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections := public.agent_auth(p_token);
  t public.tasks;
begin
  perform public.agent_touch_session(c, p_session, 'get_task_discussion');
  t := public.agent_find_task(c, p_number);
  return jsonb_strip_nulls(jsonb_build_object(
    'number', t.number,
    'priority', nullif(t.priority, 0),
    'due_on', t.due_on,
    'parent', (select jsonb_build_object('number', p.number, 'title', p.title) from public.tasks p where p.id = t.parent_id),
    'subtasks', (select jsonb_agg(jsonb_build_object('number', s.number, 'title', s.title, 'status', s.status,
                                                     'assignee', (select display_name from public.profiles where id = s.assignee_id))
                                  order by s.number)
                 from public.tasks s where s.parent_id = t.id),
    'comments', (select jsonb_agg(jsonb_build_object('at', x.created_at, 'by', x.name, 'source', x.source, 'text', x.body) order by x.created_at)
                 from (select cm.created_at, cm.source, cm.body, p.display_name as name
                       from public.task_comments cm left join public.profiles p on p.id = cm.author_id
                       where cm.task_id = t.id order by cm.created_at desc limit 20) x)
  ));
end $$;

-- Dividir: cria subtarefa de uma tarefa (para o próprio usuário ou outro membro; quem recebe aceita, salvo aceite automático).
create function public.mcp_create_subtask(
  p_token text, p_session text, p_parent integer, p_title text, p_prompt text default null, p_assignee text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections := public.agent_auth(p_token);
  p public.tasks;
  t public.tasks;
  v_title text := trim(p_title);
  v_to uuid;
begin
  if v_title is null or char_length(v_title) not between 1 and 200 then
    raise exception 'título deve ter de 1 a 200 caracteres' using errcode = '22023';
  end if;
  perform public.agent_touch_session(c, p_session, 'create_subtask');
  p := public.agent_find_task(c, p_parent);
  v_to := case when nullif(trim(p_assignee), '') is null then c.user_id else public.agent_find_member(c, p_assignee) end;
  insert into public.tasks (workspace_id, title, prompt, assignee_id, created_by, parent_id, priority)
  values (c.workspace_id, v_title, nullif(trim(p_prompt), ''), v_to, c.user_id, p.id, p.priority)
  returning * into t;
  return jsonb_build_object('ok', true, 'number', t.number, 'parent', p.number, 'status', t.status,
                            'assignee', (select display_name from public.profiles where id = t.assignee_id));
end $$;

-- Prioridade e prazo (qualquer membro, como o status).
create function public.mcp_plan_task(p_token text, p_session text, p_number integer, p_priority integer default null, p_due_on date default null, p_clear_due boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections := public.agent_auth(p_token);
  t public.tasks;
begin
  perform public.agent_touch_session(c, p_session, 'plan_task');
  t := public.agent_find_task(c, p_number);
  update public.tasks set
    priority = coalesce(p_priority, priority),
    due_on = case when p_clear_due then null else coalesce(p_due_on, due_on) end
  where id = t.id returning * into t;
  return jsonb_strip_nulls(jsonb_build_object('ok', true, 'number', t.number, 'priority', t.priority, 'due_on', t.due_on));
end $$;

revoke execute on function
  public.mcp_add_task_comment(text, text, integer, text),
  public.mcp_get_task_discussion(text, text, integer),
  public.mcp_create_subtask(text, text, integer, text, text, text),
  public.mcp_plan_task(text, text, integer, integer, date, boolean)
from public;
grant execute on function
  public.mcp_add_task_comment(text, text, integer, text),
  public.mcp_get_task_discussion(text, text, integer),
  public.mcp_create_subtask(text, text, integer, text, text, text),
  public.mcp_plan_task(text, text, integer, integer, date, boolean)
to anon, authenticated;

create or replace function public.cooper_server_info() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('app', 'cooper', 'schema', 15)
$$;

-- ===== 20261028000016_context_summaries.sql =====
-- Cooper — resumo do contexto (seção 3.4, etapa A).
-- O objetivo é DIMINUIR o contexto para as IAs gastarem menos tokens: o resumo substitui o conteúdo
-- (o anterior fica no histórico e pode ser desfeito), não se soma.
-- summarize_context devolve os blocos e a instrução; save_context_summary grava contra base_version
-- (mesma proteção de update_context_block) e registra o tamanho antes/depois em context_summaries.
-- Tokens são estimativa (caracteres ÷ 4), marcada como tal.
-- Coberto por tests/sql/summaries.test.ts.

create table public.context_summaries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  block_id uuid not null references public.context_blocks (id) on delete cascade,
  from_version integer not null,
  to_version integer not null,
  chars_before integer not null check (chars_before >= 0),
  chars_after integer not null check (chars_after >= 0),
  summarized_by uuid references auth.users (id) on delete set null,
  agent public.agent_kind,
  created_at timestamptz not null default now()
);
create index on public.context_summaries (workspace_id, created_at desc);
alter table public.context_summaries enable row level security;
create policy "membros veem resumos" on public.context_summaries for select to authenticated
  using (public.is_member(workspace_id));
alter publication supabase_realtime add table public.context_summaries;

create function public.mcp_summarize_context(p_token text, p_session text, p_blocks text[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.agent_connections := public.agent_auth(p_token);
begin
  perform public.agent_touch_session(c, p_session, 'summarize_context');
  return jsonb_build_object(
    'instructions', 'Resuma cada bloco para algo em torno de 40% do tamanho atual, sem perder decisões, contratos de API, nomes, números e convenções. '
      || 'Corte repetição, histórico e explicações óbvias; use listas curtas. Grave cada um com save_context_summary(block, content, base_version = version). '
      || 'Pule blocos já curtos (menos de 400 caracteres). Mostre ao usuário o antes/depois.',
    'total_chars', coalesce((select sum(char_length(b.content)) from public.context_blocks b
                              where b.workspace_id = c.workspace_id and b.deleted_at is null), 0),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'title', b.title, 'version', b.version, 'chars', char_length(b.content), 'content', b.content)
                       order by char_length(b.content) desc)
      from public.context_blocks b
      where b.workspace_id = c.workspace_id and b.deleted_at is null
        and (p_blocks is null or cardinality(p_blocks) = 0
             or exists (select 1 from unnest(p_blocks) x where b.id::text = trim(x) or lower(b.title) = lower(trim(x))))
    ), '[]'::jsonb)
  );
end $$;

create function public.mcp_save_context_summary(p_token text, p_session text, p_block text, p_content text, p_base_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections := public.agent_auth(p_token);
  s public.agent_sessions;
  b public.context_blocks;
  r jsonb;
begin
  s := public.agent_touch_session(c, p_session, 'save_context_summary');
  b := public.agent_find_block(c, p_block);
  if p_content is null or char_length(p_content) >= char_length(b.content) then
    raise exception 'o resumo precisa ser menor que o bloco atual (% caracteres)', char_length(b.content) using errcode = '22023';
  end if;
  r := public.ctx_write(c.workspace_id, b.id, null, p_content, p_base_version, 'update');
  if (r ->> 'ok')::boolean and not coalesce((r ->> 'unchanged')::boolean, false) then
    insert into public.context_summaries (workspace_id, block_id, from_version, to_version, chars_before, chars_after, summarized_by, agent)
    values (c.workspace_id, b.id, b.version, (r ->> 'version')::integer, char_length(b.content), char_length(p_content), c.user_id, c.agent_kind);
    r := r || jsonb_build_object('chars_before', char_length(b.content), 'chars_after', char_length(p_content),
                                 'reduction_pct', round(100 - 100.0 * char_length(p_content) / greatest(char_length(b.content), 1)),
                                 'tokens_saved_estimate', (char_length(b.content) - char_length(p_content)) / 4);
  end if;
  return r;
end $$;

revoke execute on function
  public.mcp_summarize_context(text, text, text[]),
  public.mcp_save_context_summary(text, text, text, text, integer)
from public;
grant execute on function
  public.mcp_summarize_context(text, text, text[]),
  public.mcp_save_context_summary(text, text, text, text, integer)
to anon, authenticated;

create or replace function public.cooper_server_info() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('app', 'cooper', 'schema', 16)
$$;
