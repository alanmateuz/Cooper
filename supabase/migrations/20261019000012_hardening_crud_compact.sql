-- Cooper 0.6 — segurança, CRUD completo e respostas compactas para os agentes.
--
-- 1. Versão do esquema: o app confere ao conectar num Supabase (setup com servidor próprio).
-- 2. Tarefas: só quem criou (ou o dono do projeto) edita título, prompt, descrição e critérios.
--    Mudar o prompt de uma tarefa já aceita por outra pessoa pede um novo aceite. Toda edição vira evento.
-- 3. Permissões mais estreitas: conexão de agente só pode ser revogada (nada mais muda nela);
--    pessoas não gravam eventos/vínculos como "declarado" nem mexem em sessões de agente.
-- 4. Projetos: o dono apaga o projeto; um membro pode sair. Quem sai perde tokens e uso compartilhado.
-- 5. MCP: get_briefing (tarefas + time numa chamada), respostas sem campos vazios,
--    resumo do projeto só quando pedido e edição de contexto por trecho (patch_context_block).
-- Coberto por tests/hardening.test.ts.

-- ───────────── 1. versão ─────────────
create function public.cooper_server_info() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('app', 'cooper', 'schema', 12)
$$;
grant execute on function public.cooper_server_info() to anon, authenticated;

-- ───────────── 2. edição de tarefas ─────────────
create function public.guard_task_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_actor();
begin
  if new.title is not distinct from old.title
     and new.prompt is not distinct from old.prompt
     and new.description is not distinct from old.description
     and new.acceptance_criteria is not distinct from old.acceptance_criteria then
    return new;
  end if;
  if v_actor is distinct from old.created_by and not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = old.workspace_id and m.user_id = v_actor and m.role = 'owner'
  ) then
    raise exception 'só quem criou a tarefa (ou o dono do projeto) edita título, prompt, descrição e critérios'
      using errcode = '42501';
  end if;
  new.prompt := nullif(trim(new.prompt), '');
  new.description := nullif(trim(new.description), '');
  new.acceptance_criteria := nullif(trim(new.acceptance_criteria), '');
  -- prompt novo numa tarefa que outra pessoa já aceitou: ela precisa aceitar de novo
  if new.prompt is distinct from old.prompt
     and old.status in ('backlog', 'in_progress', 'in_review')
     and new.assignee_id is not distinct from old.assignee_id
     and new.assignee_id is not null and new.assignee_id is distinct from v_actor then
    new.status := 'awaiting_acceptance';
    new.accepted_at := null;
  end if;
  return new;
end $$;
-- roda depois de before_task_update (ordem alfabética dos triggers)
create trigger before_task_update_edit before update on public.tasks
  for each row execute function public.guard_task_edit();

-- Eventos: envio, edição e mudança de status (uma mesma atualização pode gerar mais de um).
create or replace function public.log_task_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_agent boolean := auth.uid() is null and nullif(current_setting('cooper.actor', true), '') is not null;
  v_source public.event_source := case when v_agent then 'agent_declared' else 'user' end;
  v_session uuid := case when v_agent then nullif(current_setting('cooper.session', true), '')::uuid end;
  v_actor uuid := public.current_actor();
  v_fields text[];
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (workspace_id, task_id, user_id, agent_session_id, source, type, payload)
    values (new.workspace_id, new.id, v_actor, v_session, v_source, 'task_created',
            jsonb_strip_nulls(jsonb_build_object('assignee_id', new.assignee_id, 'to_status', new.status)));
    return null;
  end if;

  v_fields := array_remove(array[
    case when new.title is distinct from old.title then 'title' end,
    case when new.prompt is distinct from old.prompt then 'prompt' end,
    case when new.description is distinct from old.description then 'description' end,
    case when new.acceptance_criteria is distinct from old.acceptance_criteria then 'acceptance_criteria' end
  ], null);
  if cardinality(v_fields) > 0 then
    insert into public.task_events (workspace_id, task_id, user_id, agent_session_id, source, type, payload)
    values (new.workspace_id, new.id, v_actor, v_session, v_source, 'task_edited',
            jsonb_build_object('fields', to_jsonb(v_fields),
                               'reaccept', new.status = 'awaiting_acceptance' and old.status <> 'awaiting_acceptance'));
  end if;

  if new.assignee_id is distinct from old.assignee_id and new.status = 'awaiting_acceptance' then
    insert into public.task_events (workspace_id, task_id, user_id, agent_session_id, source, type, payload)
    values (new.workspace_id, new.id, v_actor, v_session, v_source, 'task_sent', jsonb_build_object('assignee_id', new.assignee_id));
  elsif new.status <> old.status then
    insert into public.task_events (workspace_id, task_id, user_id, agent_session_id, source, type, payload)
    values (new.workspace_id, new.id, v_actor, v_session, v_source, 'status_changed',
            jsonb_strip_nulls(jsonb_build_object(
              'from_status', old.status, 'to_status', new.status,
              'reason', case when new.status = 'declined' then new.decline_reason end)));
  end if;
  return null;
end $$;

revoke execute on function public.guard_task_edit() from public, anon, authenticated;

-- ───────────── 3. permissões mais estreitas ─────────────

-- Conexões de agente: a pessoa só revoga (não reativa, não muda workspace, hash ou tipo).
revoke update on public.agent_connections from anon, authenticated;
grant update (revoked_at) on public.agent_connections to authenticated;
drop policy "revogar as próprias conexões" on public.agent_connections;
create policy "revogar as próprias conexões" on public.agent_connections for update to authenticated
  using (user_id = auth.uid() and public.jwt_workspace() is null)
  with check (user_id = auth.uid() and revoked_at is not null);

-- Eventos: "declarado" só sai das RPCs dos agentes (que rodam como definer).
drop policy "membros registram eventos próprios" on public.task_events;
create policy "membros registram eventos próprios" on public.task_events for insert to authenticated
  with check (
    public.is_member(workspace_id)
    and user_id = auth.uid()
    and source in ('user', 'local_git')
    and (task_id is null or exists (select 1 from public.tasks t where t.id = task_id and t.workspace_id = task_events.workspace_id))
  );

drop policy "membros criam vínculos manuais" on public.task_links;
create policy "membros criam vínculos manuais" on public.task_links for insert to authenticated
  with check (public.is_member(workspace_id) and source = 'user'
    and exists (select 1 from public.tasks t where t.id = task_id and t.workspace_id = task_links.workspace_id));

-- Sessões de agente: só as RPCs gravam. Pessoas não forjam "Executando" (has_hooks) nem atividade.
drop policy "registrar a própria sessão" on public.agent_sessions;
drop policy "atualizar a própria sessão" on public.agent_sessions;

-- ───────────── 4. projetos e membros ─────────────
create policy "dono apaga o projeto" on public.workspaces for delete to authenticated
  using (public.is_owner(id));

create policy "membro sai do projeto" on public.workspace_members for delete to authenticated
  using (user_id = auth.uid() and role = 'member' and public.jwt_workspace() is null);

-- Quem sai (ou é removido) perde os tokens de agente e o uso compartilhado daquele projeto.
create function public.cleanup_member_exit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- apagar o projeto inteiro também remove os membros: aí as linhas já vão embora em cascata
  if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return null;
  end if;
  update public.agent_connections set revoked_at = now()
  where workspace_id = old.workspace_id and user_id = old.user_id and revoked_at is null;
  delete from public.ai_usage where workspace_id = old.workspace_id and user_id = old.user_id;
  return null;
end $$;
revoke execute on function public.cleanup_member_exit() from public, anon, authenticated;
create trigger after_member_exit after delete on public.workspace_members
  for each row execute function public.cleanup_member_exit();

-- ───────────── 5. MCP compacto ─────────────

-- Briefing de início de conversa: minhas tarefas e o que o time está fazendo, numa chamada.
create function public.mcp_get_briefing(p_token text, p_session text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.agent_connections := public.agent_auth(p_token);
begin
  perform public.agent_touch_session(c, p_session, 'get_briefing');
  return jsonb_strip_nulls(jsonb_build_object(
    'awaiting_acceptance', (
      select jsonb_agg(jsonb_build_object('number', t.number, 'title', t.title, 'from', p.display_name, 'has_prompt', t.prompt is not null)
                       order by t.number)
      from public.tasks t left join public.profiles p on p.id = t.created_by
      where t.workspace_id = c.workspace_id and t.assignee_id = c.user_id and t.status = 'awaiting_acceptance'),
    'tasks', (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'number', t.number, 'title', t.title, 'status', t.status,
               'from', case when t.created_by <> c.user_id then p.display_name end))
             order by t.status, t.number)
      from public.tasks t left join public.profiles p on p.id = t.created_by
      where t.workspace_id = c.workspace_id and t.assignee_id = c.user_id
        and t.status not in ('awaiting_acceptance', 'declined', 'done')),
    'declined_by_others', (
      select jsonb_agg(jsonb_build_object('number', t.number, 'title', t.title, 'by', p.display_name, 'reason', t.decline_reason)
                       order by t.declined_at desc)
      from public.tasks t left join public.profiles p on p.id = t.assignee_id
      where t.workspace_id = c.workspace_id and t.created_by = c.user_id and t.assignee_id <> c.user_id and t.status = 'declined'),
    'team', (
      select jsonb_agg(person order by person ->> 'name')
      from (
        select jsonb_strip_nulls(jsonb_build_object(
          'name', p.display_name,
          'agent', s.agent_kind,
          'task', (select '#' || t.number || ' ' || t.title from public.tasks t where t.id = s.current_task_id),
          'activity', s.activity_text,
          'minutes_ago', (extract(epoch from now() - s.last_event_at) / 60)::int,
          'branch', g.branch,
          'uncommitted', nullif(g.dirty_files_count, 0),
          'files', case when g.dirty_files is not null and cardinality(g.dirty_files) > 0
                        then to_jsonb(g.dirty_files[1:10]) end
        )) as person
        from public.workspace_members m
        join public.profiles p on p.id = m.user_id
        left join lateral (
          select * from public.agent_sessions s
          where s.workspace_id = c.workspace_id and s.user_id = m.user_id
            and s.ended_at is null and s.last_event_at > now() - interval '2 hours'
            and not exists (select 1 from public.agent_connections ac where ac.id = s.agent_connection_id and ac.revoked_at is not null)
          order by s.last_event_at desc limit 1
        ) s on true
        left join lateral (
          select * from public.git_snapshots g where g.workspace_id = c.workspace_id and g.user_id = m.user_id
          order by g.observed_at desc limit 1
        ) g on true
        where m.workspace_id = c.workspace_id and m.user_id <> c.user_id
      ) people)
  ));
end $$;

-- Status do time (compatibilidade): no máximo 20 nomes de arquivo por pessoa, com o total.
create or replace function public.mcp_get_team_status(p_token text, p_session text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.agent_connections := public.agent_auth(p_token);
begin
  perform public.agent_touch_session(c, p_session, 'get_team_status');
  return coalesce((
    select jsonb_agg(person order by person ->> 'name')
    from (
      select jsonb_strip_nulls(jsonb_build_object(
        'name', p.display_name,
        'sessions', (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'agent', s.agent_kind,
            'task', (select '#' || t.number || ' ' || t.title from public.tasks t where t.id = s.current_task_id),
            'activity', s.activity_text,
            'minutes_ago', (extract(epoch from now() - s.last_event_at) / 60)::int
          )) order by s.last_event_at desc nulls last)
          from public.agent_sessions s
          where s.workspace_id = c.workspace_id and s.user_id = m.user_id
            and s.ended_at is null and s.last_event_at > now() - interval '2 hours'
            and not exists (select 1 from public.agent_connections ac where ac.id = s.agent_connection_id and ac.revoked_at is not null)),
        'git', (select jsonb_strip_nulls(jsonb_build_object(
                         'branch', g.branch, 'head', left(g.head_sha, 7), 'behind', nullif(g.behind, 0),
                         'uncommitted', g.dirty_files_count,
                         'files', case when g.dirty_files is not null then to_jsonb(g.dirty_files[1:20]) end))
                from public.git_snapshots g where g.workspace_id = c.workspace_id and g.user_id = m.user_id
                order by g.observed_at desc limit 1),
        'tasks_in_progress', (select jsonb_agg('#' || t.number || ' ' || t.title order by t.number)
                              from public.tasks t
                              where t.workspace_id = c.workspace_id and t.assignee_id = m.user_id and t.status = 'in_progress')
      )) as person
      from public.workspace_members m
      join public.profiles p on p.id = m.user_id
      where m.workspace_id = c.workspace_id and m.user_id <> c.user_id
    ) people
  ), '[]'::jsonb);
end $$;

-- Contexto da tarefa: sem campos vazios; o resumo do projeto só vem quando pedido (p_summary).
drop function public.mcp_get_task_context(text, text, integer);
create function public.mcp_get_task_context(p_token text, p_session text, p_number integer, p_summary boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections := public.agent_auth(p_token);
  t public.tasks;
  s public.context_blocks;
begin
  perform public.agent_touch_session(c, p_session, 'get_task_context');
  t := public.agent_find_task(c, p_number);
  if p_summary then
    select * into s from public.context_blocks
    where workspace_id = c.workspace_id and deleted_at is null
    order by (lower(title) like 'resumo%') desc, position limit 1;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'number', t.number,
    'title', t.title,
    'status', t.status,
    'sent_by', (select display_name from public.profiles where id = t.created_by),
    'assignee', (select display_name from public.profiles where id = t.assignee_id),
    'assigned_to_you', t.assignee_id = c.user_id,
    'prompt', t.prompt,
    'description', t.description,
    'acceptance_criteria', t.acceptance_criteria,
    'decline_reason', t.decline_reason,
    'links', (select jsonb_agg(l.kind || ': ' || l.ref) from public.task_links l where l.task_id = t.id),
    'depends_on', (select jsonb_agg('#' || d.number || ' ' || d.title || ' (' || d.status || ')')
                   from public.task_dependencies td join public.tasks d on d.id = td.depends_on_task_id
                   where td.task_id = t.id),
    'project_summary', case when s.id is not null then
                         jsonb_build_object('title', s.title, 'content', left(s.content, 2000), 'truncated', char_length(s.content) > 2000) end,
    'recent_progress', (select jsonb_agg(e.payload ->> 'text')
                        from (select * from public.task_events
                              where task_id = t.id and type = 'report_progress'
                              order by occurred_at desc limit 5) e)
  ));
end $$;

-- Contexto do workspace: lista curta (título, versão, tamanho, prévia) ou o conteúdo dos blocos pedidos.
create or replace function public.mcp_get_workspace_context(p_token text, p_session text, p_blocks text[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections := public.agent_auth(p_token);
begin
  perform public.agent_touch_session(c, p_session, 'get_workspace_context');
  if p_blocks is not null and cardinality(p_blocks) > 0 then
    return jsonb_strip_nulls(jsonb_build_object(
      'blocks', (
        select jsonb_agg(jsonb_build_object('title', b.title, 'version', b.version, 'content', b.content) order by b.position)
        from public.context_blocks b
        where b.workspace_id = c.workspace_id and b.deleted_at is null
          and exists (select 1 from unnest(p_blocks) x where b.id::text = trim(x) or lower(b.title) = lower(trim(x)))),
      'not_found', (
        select jsonb_agg(x) from unnest(p_blocks) x
        where not exists (select 1 from public.context_blocks b where b.workspace_id = c.workspace_id and b.deleted_at is null
                            and (b.id::text = trim(x) or lower(b.title) = lower(trim(x)))))
    ));
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'workspace', (select name from public.workspaces where id = c.workspace_id),
    'repositories', (select jsonb_agg(r.owner || '/' || r.name) from public.repositories r where r.workspace_id = c.workspace_id),
    'blocks', (
      select jsonb_agg(jsonb_build_object(
               'title', b.title, 'version', b.version, 'chars', char_length(b.content),
               'preview', left(regexp_replace(b.content, '\s+', ' ', 'g'), 120)
             ) order by b.position)
      from public.context_blocks b where b.workspace_id = c.workspace_id and b.deleted_at is null)
  ));
end $$;

-- Editar um bloco sem reenviar tudo: acrescentar ao final (p_append) ou trocar um trecho exato (p_old → p_new).
-- Aplicado sobre a versão atual, na mesma transação; o trecho precisa aparecer exatamente uma vez.
create function public.mcp_patch_context_block(
  p_token text, p_session text, p_block text,
  p_append text default null, p_old text default null, p_new text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections := public.agent_auth(p_token);
  b public.context_blocks;
  v_content text;
  v_count integer;
begin
  perform public.agent_touch_session(c, p_session, 'patch_context_block');
  b := public.agent_find_block(c, p_block);
  select * into b from public.context_blocks where id = b.id for update;
  if (p_append is null) = (p_old is null) then
    raise exception 'informe append ou old_text/new_text (um dos dois)' using errcode = '22023';
  end if;
  if p_append is not null then
    v_content := case when b.content = '' then p_append else rtrim(b.content, e'\n') || e'\n' || p_append end;
  else
    if p_old = '' then
      raise exception 'old_text vazio' using errcode = '22023';
    end if;
    v_count := (char_length(b.content) - char_length(replace(b.content, p_old, ''))) / char_length(p_old);
    if v_count <> 1 then
      raise exception 'o trecho aparece % vez(es) no bloco "%"; use um trecho maior e único', v_count, b.title using errcode = '22023';
    end if;
    v_content := replace(b.content, p_old, coalesce(p_new, ''));
  end if;
  return public.ctx_write(c.workspace_id, b.id, null, v_content, b.version, 'update');
end $$;

revoke execute on function
  public.mcp_get_briefing(text, text),
  public.mcp_get_task_context(text, text, integer, boolean),
  public.mcp_patch_context_block(text, text, text, text, text, text)
from public;
grant execute on function
  public.mcp_get_briefing(text, text),
  public.mcp_get_task_context(text, text, integer, boolean),
  public.mcp_patch_context_block(text, text, text, text, text, text)
to anon, authenticated;

