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
