-- Atualização do esquema 20 para 21 (ajustes do Cooper 0.8.1). Para quem já rodou o 19-para-20. Cole no SQL Editor e rode uma vez.

--
-- 1. Um PR ligado a várias tarefas gerava um aviso igual por tarefa no since_last ("aberto" cinco vezes).
--    O briefing agora junta os avisos do mesmo PR e da mesma mudança numa linha só, com as tarefas listadas.
--    Os eventos continuam um por tarefa: a linha do tempo de cada tarefa não muda.
-- 2. A tarefa-mãe nunca recebia start_task, então ficava sem branch e sem o PR. Começar uma subtarefa numa branch
--    agora liga a mesma branch à mãe (e as subtarefas que já tinham branch ligam a mãe aqui).
-- 3. Projeto novo já nasce com os blocos Decisões e Handoffs, que as IAs usam para registrar o que decidiram e
--    para passar trabalho adiante (antes o primeiro patch_context_block falhava por falta do bloco).
-- Coberto por tests/sql/github.test.ts e tests/sql/subtasks.test.ts.

-- ───────────── 3. blocos padrão de um projeto novo ─────────────

create or replace function public.handle_new_workspace() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role) values (new.id, new.created_by, 'owner');
  insert into public.context_blocks (workspace_id, title, content, position, updated_by) values
    (new.id, 'Decisões', 'Uma linha por decisão: data, tarefa e o que foi decidido.', 0, new.created_by),
    (new.id, 'Handoffs', 'Quem passa uma tarefa adiante registra aqui: branch@commit, o que foi feito, o que falta e cuidados.', 1, new.created_by);
  return new;
end $$;

-- ───────────── 2. a branch da subtarefa também é da mãe ─────────────

create or replace function public.mcp_start_task(p_token text, p_session text, p_number integer, p_branch text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections := public.agent_auth(p_token);
  s public.agent_sessions;
  t public.tasks;
  v_branch text := nullif(trim(p_branch), '');
begin
  if v_branch is not null and (char_length(v_branch) > 200 or v_branch !~ '^[A-Za-z0-9._/\-]+$') then
    raise exception 'nome de branch inválido' using errcode = '22023';
  end if;
  s := public.agent_touch_session(c, p_session, 'start_task');
  t := public.agent_find_task(c, p_number);
  if t.status = 'done' then
    raise exception 'tarefa #% já está concluída', p_number using errcode = '22023';
  end if;
  if t.status = 'awaiting_acceptance' then
    raise exception 'tarefa #% aguarda aceite: pergunte ao usuário se ele aceita (accept_task) antes de começar', p_number using errcode = '22023';
  end if;
  if t.status = 'declined' then
    raise exception 'tarefa #% foi recusada', p_number using errcode = '22023';
  end if;
  perform public.agent_can_work_on(c, t);

  update public.tasks set
    status = case when status = 'backlog' then 'in_progress'::public.task_status else status end,
    assignee_id = coalesce(assignee_id, c.user_id)
  where id = t.id
  returning * into t;

  update public.agent_sessions set current_task_id = t.id, activity_text = null where id = s.id;

  insert into public.task_events (workspace_id, task_id, user_id, agent_session_id, source, type, payload)
  values (c.workspace_id, t.id, c.user_id, s.id, 'agent_declared', 'start_task',
          case when v_branch is null then '{}'::jsonb else jsonb_build_object('branch', v_branch) end);

  if v_branch is not null then
    -- a mãe ganha a mesma branch, para o PR das subtarefas também aparecer nela
    insert into public.task_links (workspace_id, task_id, kind, ref, source)
    select c.workspace_id, x.id, 'branch', v_branch, 'agent_declared'
    from (select t.id union all select t.parent_id where t.parent_id is not null) x
    on conflict (task_id, kind, ref) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'number', t.number, 'title', t.title, 'status', t.status);
end $$;

insert into public.task_links (workspace_id, task_id, kind, ref, source)
select distinct l.workspace_id, t.parent_id, 'branch'::public.task_link_kind, l.ref, l.source
from public.task_links l
join public.tasks t on t.id = l.task_id
where l.kind = 'branch' and t.parent_id is not null
on conflict (task_id, kind, ref) do nothing;

-- ───────────── 1. briefing: um aviso por PR e mudança ─────────────

-- mcp_get_briefing da 0020, com os eventos pr_update agrupados no since_last.
create or replace function public.mcp_get_briefing(p_token text, p_session text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections := public.agent_auth(p_token);
  v_since timestamptz := coalesce(c.briefing_seen_at, now() - interval '12 hours');
  v_result jsonb;
begin
  perform public.agent_touch_session(c, p_session, 'get_briefing');
  v_result := jsonb_strip_nulls(jsonb_build_object(
    'since_last', (
      select jsonb_agg(line order by at desc)
      from (
        select * from (
          select coalesce(p.display_name, case when e.source = 'github' then 'GitHub' else 'Alguém' end)
                 || ' ' || l.line || ' (' || public.ago(e.occurred_at) || ')' as line, e.occurred_at as at
          from public.task_events e
          left join public.profiles p on p.id = e.user_id
          cross join lateral (select left(public.briefing_line(c, e), 200) as line) l
          where e.workspace_id = c.workspace_id and e.occurred_at > v_since
            and e.user_id is distinct from c.user_id and l.line is not null and e.type <> 'pr_update'
          union all
          -- "GitHub PR #2 (#2, #3, #4): aberto": as tarefas da mesma branch numa linha só
          select left('GitHub PR #' || g.pr || ' ('
                      || case when count(*) = 1 then min('#' || g.number || ' ' || g.title)
                              else string_agg('#' || g.number, ', ' order by g.number) end
                      || '): ' || case g.change
                        when 'opened' then 'aberto'
                        when 'merged' then 'merge feito'
                        when 'closed' then 'fechado sem merge'
                        when 'checks_failure' then 'CI falhou'
                        when 'checks_success' then 'CI passou'
                        when 'approved' then 'aprovado'
                        when 'changes_requested' then 'pediram mudanças'
                        else g.change end, 200)
                 || ' (' || public.ago(max(g.occurred_at)) || ')' as line, max(g.occurred_at) as at
          from (
            select distinct on (e.task_id, e.payload ->> 'pr', e.payload ->> 'change')
                   e.payload ->> 'pr' as pr, e.payload ->> 'change' as change, t.number, t.title, e.occurred_at
            from public.task_events e
            join public.tasks t on t.id = e.task_id
            where e.workspace_id = c.workspace_id and e.occurred_at > v_since and e.type = 'pr_update'
            order by e.task_id, e.payload ->> 'pr', e.payload ->> 'change', e.occurred_at desc
          ) g
          group by g.pr, g.change
        ) x
        order by at desc limit 12
      ) y),
    'awaiting_acceptance', (
      select jsonb_agg(jsonb_build_object('number', t.number, 'title', t.title, 'from', p.display_name, 'has_prompt', t.prompt is not null)
                       order by t.number)
      from public.tasks t left join public.profiles p on p.id = t.created_by
      where t.workspace_id = c.workspace_id and t.assignee_id = c.user_id and t.status = 'awaiting_acceptance'),
    'tasks', (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'number', t.number, 'title', t.title, 'status', t.status,
               'from', case when t.created_by <> c.user_id then p.display_name end,
               'blocked', t.blocked_reason,
               'waiting_on', public.open_dependencies(t.id)))
             order by t.status, t.number)
      from public.tasks t left join public.profiles p on p.id = t.created_by
      where t.workspace_id = c.workspace_id and t.assignee_id = c.user_id
        and t.status not in ('awaiting_acceptance', 'declined', 'done')),
    'over_limit', public.wip_warning(c.workspace_id, c.user_id),
    'pull_requests', (
      select jsonb_agg(public.pr_line(r) order by r.number desc)
      from (select * from public.github_pull_requests r
            where r.workspace_id = c.workspace_id and r.state = 'open' order by r.number desc limit 10) r),
    'your_repo_access', (select case m.repo_access when 'read' then 'só leitura: push vai falhar' when 'none' then 'sem acesso ao repositório' end
                         from public.workspace_members m where m.workspace_id = c.workspace_id and m.user_id = c.user_id),
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
          'availability', public.member_availability(m),
          'repo_access', case m.repo_access when 'read' then 'só leitura (não consegue push)' when 'none' then 'sem acesso ao repositório' end,
          'agent', s.agent_kind,
          'task', (select '#' || t.number || ' ' || t.title from public.tasks t where t.id = s.current_task_id),
          'activity', s.activity_text,
          'minutes_ago', (extract(epoch from now() - s.last_event_at) / 60)::int,
          'blocked', (select jsonb_agg('#' || t.number || ': ' || t.blocked_reason order by t.number) from public.tasks t
                      where t.workspace_id = c.workspace_id and t.assignee_id = m.user_id and t.blocked_reason is not null
                        and t.status not in ('done', 'declined')),
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
  update public.agent_connections set briefing_seen_at = now() where id = c.id;
  return v_result;
end $$;

create or replace function public.cooper_server_info() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('app', 'cooper', 'schema', 21)
$$;
