-- Atualização do esquema 18 para 19 (coordenação entre agentes, Cooper 0.8). Para quem já rodou o 17-para-18. Cole no SQL Editor e rode uma vez.

--
-- 1. Dependências: create_task aceita depends_on e set_dependencies troca a lista. Quando uma tarefa é concluída,
--    cada tarefa que dependia dela ganha um evento dependency_done (o "LIBERA" deixa de ser manual).
-- 2. Briefing com novidades: since_last traz o que os outros fizeram desde o último briefing deste token
--    (conclusões, recusas, comentários nas suas tarefas, dependências liberadas, bloqueios, sinais, contexto).
-- 3. Bloqueio de verdade: set_blocked marca a tarefa com um motivo; o briefing mostra o que está bloqueado ou esperando.
-- 4. get_task_context traz o resumo e as evidências da conclusão e quem depende da tarefa.
-- 5. handoff_task: quem tem a tarefa passa para outra pessoa com uma nota, sem precisar do modo coordenador.
-- 6. Limite de tarefas abertas por pessoa (wip_limit, por projeto) e disponibilidade do agente (set_availability).
-- Coberto por tests/sql/coordination.test.ts.

alter table public.tasks
  add column blocked_reason text check (char_length(blocked_reason) between 1 and 300),
  add column blocked_at timestamptz;

alter table public.workspace_members
  add column availability text check (availability in ('available', 'busy', 'near_limit', 'away')),
  add column availability_note text check (char_length(availability_note) <= 120),
  add column availability_at timestamptz;

alter table public.workspaces add column wip_limit smallint check (wip_limit between 1 and 20);

alter table public.agent_connections add column briefing_seen_at timestamptz;

-- ───────────── auxiliares ─────────────

-- Números de tarefa → ids, no workspace do agente. Erro se algum não existir.
create function public.agent_task_ids(c public.agent_connections, p_numbers integer[]) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_missing integer[];
begin
  if p_numbers is null or cardinality(p_numbers) = 0 then
    return '{}';
  end if;
  if cardinality(p_numbers) > 20 then
    raise exception 'até 20 dependências' using errcode = '22023';
  end if;
  select array_agg(n) into v_missing from unnest(p_numbers) n
  where not exists (select 1 from public.tasks t where t.workspace_id = c.workspace_id and t.number = n);
  if v_missing is not null then
    raise exception 'tarefa(s) não encontrada(s): %', array_to_string(v_missing, ', ') using errcode = '22023';
  end if;
  select array_agg(distinct t.id) into v_ids from public.tasks t where t.workspace_id = c.workspace_id and t.number = any (p_numbers);
  return v_ids;
end $$;
revoke execute on function public.agent_task_ids(public.agent_connections, integer[]) from public, anon, authenticated;

-- Troca as dependências de uma tarefa, recusando ciclos (A espera B que espera A).
create function public.replace_task_dependencies(p_task public.tasks, p_deps uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_task.id = any (p_deps) then
    raise exception 'a tarefa #% não pode depender dela mesma', p_task.number using errcode = '22023';
  end if;
  if exists (
    with recursive up(id) as (
      select unnest(p_deps)
      union
      select td.depends_on_task_id from public.task_dependencies td join up on td.task_id = up.id
    )
    select 1 from up where up.id = p_task.id
  ) then
    raise exception 'dependência circular: alguma dessas tarefas já espera a #%', p_task.number using errcode = '22023';
  end if;
  delete from public.task_dependencies where task_id = p_task.id;
  insert into public.task_dependencies (task_id, depends_on_task_id, workspace_id)
  select p_task.id, d, p_task.workspace_id from unnest(p_deps) d;
end $$;
revoke execute on function public.replace_task_dependencies(public.tasks, uuid[]) from public, anon, authenticated;

-- Dependências que ainda não terminaram, como "#3 Título".
create function public.open_dependencies(p_task uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_agg('#' || d.number || ' ' || d.title order by d.number)
  from public.task_dependencies td join public.tasks d on d.id = td.depends_on_task_id
  where td.task_id = p_task and d.status <> 'done'
$$;
revoke execute on function public.open_dependencies(uuid) from public, anon, authenticated;

-- Aviso quando a pessoa passa do limite de tarefas abertas do projeto (null: sem limite ou dentro dele).
create function public.wip_warning(p_ws uuid, p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select format('%s tem %s tarefas abertas (limite do projeto: %s)', p.display_name, x.n, w.wip_limit)
  from public.workspaces w
  join public.profiles p on p.id = p_user
  cross join lateral (
    select count(*) n from public.tasks t
    where t.workspace_id = p_ws and t.assignee_id = p_user and t.status in ('awaiting_acceptance', 'backlog', 'in_progress')
  ) x
  where w.id = p_ws and w.wip_limit is not null and x.n > w.wip_limit
$$;
revoke execute on function public.wip_warning(uuid, uuid) from public, anon, authenticated;

-- Fonte e sessão do evento, iguais às do log_task_change.
create function public.event_origin(out source public.event_source, out session uuid)
language sql stable set search_path = '' as $$
  select case when auth.uid() is null and nullif(current_setting('cooper.actor', true), '') is not null
              then 'agent_declared'::public.event_source else 'user'::public.event_source end,
         case when auth.uid() is null then nullif(current_setting('cooper.session', true), '')::uuid end
$$;
revoke execute on function public.event_origin() from public, anon, authenticated;

-- ───────────── dependência concluída avisa quem esperava ─────────────
create function public.notify_dependents() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o record;
begin
  select * into o from public.event_origin();
  insert into public.task_events (workspace_id, task_id, user_id, agent_session_id, source, type, payload)
  select new.workspace_id, dep.id, public.current_actor(), o.session, o.source, 'dependency_done',
         jsonb_build_object('number', new.number, 'title', new.title,
                            'all_done', public.open_dependencies(dep.id) is null)
  from public.task_dependencies td join public.tasks dep on dep.id = td.task_id
  where td.depends_on_task_id = new.id and dep.status not in ('done', 'declined');
  return null;
end $$;
revoke execute on function public.notify_dependents() from public, anon, authenticated;
create trigger after_task_done after update of status on public.tasks
  for each row when (new.status = 'done' and old.status is distinct from 'done')
  execute function public.notify_dependents();

-- ───────────── criar tarefa com dependências ─────────────
drop function public.mcp_create_task(text, text, text, text, text);
create function public.mcp_create_task(
  p_token text, p_session text, p_title text, p_prompt text default null, p_assignee text default null, p_depends_on integer[] default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections := public.agent_auth(p_token);
  v_title text := trim(p_title);
  v_prompt text := nullif(trim(p_prompt), '');
  v_assignee uuid;
  v_deps uuid[];
  t public.tasks;
begin
  if v_title is null or char_length(v_title) not between 1 and 200 then
    raise exception 'título deve ter de 1 a 200 caracteres' using errcode = '22023';
  end if;
  if v_prompt is not null and char_length(v_prompt) > 20000 then
    raise exception 'prompt grande demais (até 20000 caracteres)' using errcode = '22023';
  end if;
  perform public.agent_touch_session(c, p_session, 'create_task');
  v_assignee := case when nullif(trim(p_assignee), '') is null then c.user_id else public.agent_find_member(c, p_assignee) end;
  v_deps := public.agent_task_ids(c, p_depends_on);

  insert into public.tasks (workspace_id, title, prompt, assignee_id, created_by)
  values (c.workspace_id, v_title, v_prompt, v_assignee, c.user_id)
  returning * into t;
  if cardinality(v_deps) > 0 then
    perform public.replace_task_dependencies(t, v_deps);
  end if;

  return jsonb_strip_nulls(jsonb_build_object('ok', true, 'number', t.number, 'title', t.title, 'status', t.status,
                            'assignee', (select display_name from public.profiles where id = t.assignee_id),
                            'waiting_on', public.open_dependencies(t.id),
                            'warning', public.wip_warning(t.workspace_id, t.assignee_id)));
end $$;

create function public.mcp_set_dependencies(p_token text, p_session text, p_number integer, p_depends_on integer[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections := public.agent_auth(p_token);
  t public.tasks;
begin
  perform public.agent_touch_session(c, p_session, 'set_dependencies');
  t := public.agent_find_task(c, p_number);
  perform public.replace_task_dependencies(t, public.agent_task_ids(c, p_depends_on));
  return jsonb_strip_nulls(jsonb_build_object('ok', true, 'number', t.number,
    'depends_on', (select jsonb_agg('#' || d.number || ' (' || d.status || ')' order by d.number)
                   from public.task_dependencies td join public.tasks d on d.id = td.depends_on_task_id where td.task_id = t.id),
    'waiting_on', public.open_dependencies(t.id)));
end $$;

-- ───────────── bloqueio ─────────────
create function public.mcp_set_blocked(p_token text, p_session text, p_number integer, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections := public.agent_auth(p_token);
  s public.agent_sessions;
  t public.tasks;
  v_reason text := nullif(trim(p_reason), '');
begin
  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception 'motivo até 300 caracteres' using errcode = '22023';
  end if;
  s := public.agent_touch_session(c, p_session, 'set_blocked');
  t := public.agent_find_task(c, p_number);
  if t.status in ('done', 'declined') then
    raise exception 'tarefa #% está %', t.number, t.status using errcode = '22023';
  end if;
  perform public.agent_can_work_on(c, t);
  if v_reason is null and t.blocked_reason is null then
    return jsonb_build_object('ok', true, 'number', t.number, 'blocked', false);
  end if;
  update public.tasks set blocked_reason = v_reason, blocked_at = case when v_reason is null then null else now() end
  where id = t.id;
  insert into public.task_events (workspace_id, task_id, user_id, agent_session_id, source, type, payload)
  values (c.workspace_id, t.id, c.user_id, s.id, 'agent_declared',
          case when v_reason is null then 'task_unblocked' else 'task_blocked' end,
          case when v_reason is null then '{}'::jsonb else jsonb_build_object('reason', v_reason) end);
  return jsonb_build_object('ok', true, 'number', t.number, 'blocked', v_reason is not null);
end $$;

-- ───────────── passar a tarefa adiante ─────────────
create function public.mcp_handoff_task(p_token text, p_session text, p_number integer, p_to text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections := public.agent_auth(p_token);
  s public.agent_sessions;
  t public.tasks;
  v_to uuid;
  v_note text := trim(p_note);
begin
  if v_note is null or char_length(v_note) not between 1 and 1900 then
    raise exception 'a nota do handoff deve ter de 1 a 1900 caracteres (estado, próximos passos, branch)' using errcode = '22023';
  end if;
  s := public.agent_touch_session(c, p_session, 'handoff_task');
  t := public.agent_find_task(c, p_number);
  if t.status in ('done', 'declined') then
    raise exception 'tarefa #% está %', t.number, t.status using errcode = '22023';
  end if;
  if c.user_id is distinct from t.assignee_id and c.user_id <> t.created_by
     and not public.member_flag(c.workspace_id, c.user_id, 'ai_coordinator') then
    raise exception 'só quem tem a tarefa, quem a criou ou uma IA no modo coordenador passa a #% adiante', t.number using errcode = '42501';
  end if;
  v_to := public.agent_find_member(c, p_to);
  if v_to is not distinct from t.assignee_id then
    raise exception 'a tarefa #% já é dessa pessoa', t.number using errcode = '22023';
  end if;

  update public.tasks set assignee_id = v_to, blocked_reason = null, blocked_at = null where id = t.id returning * into t;
  insert into public.task_comments (workspace_id, task_id, author_id, source, agent_session_id, body)
  values (c.workspace_id, t.id, c.user_id, 'agent_declared', s.id, 'Handoff: ' || v_note);
  update public.agent_sessions set current_task_id = null where id = s.id and current_task_id = t.id;

  return jsonb_strip_nulls(jsonb_build_object('ok', true, 'number', t.number, 'status', t.status,
                            'assignee', (select display_name from public.profiles where id = v_to),
                            'warning', public.wip_warning(t.workspace_id, v_to)));
end $$;

-- Redistribuir (modo coordenador): igual ao da 0013, agora com o aviso de limite.
create or replace function public.mcp_assign_task(p_token text, p_session text, p_number integer, p_assignee text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections := public.agent_auth(p_token);
  t public.tasks;
  v_to uuid;
begin
  perform public.agent_touch_session(c, p_session, 'assign_task');
  perform public.agent_require_coordinator(c);
  t := public.agent_find_task(c, p_number);
  if t.status = 'done' then
    raise exception 'tarefa #% já está concluída', p_number using errcode = '22023';
  end if;
  v_to := public.agent_find_member(c, p_assignee);
  update public.tasks set assignee_id = v_to where id = t.id returning * into t;
  return jsonb_strip_nulls(jsonb_build_object('ok', true, 'number', t.number, 'status', t.status,
                            'assignee', (select display_name from public.profiles where id = v_to),
                            'auto_accepted', t.status <> 'awaiting_acceptance' and v_to <> c.user_id,
                            'warning', public.wip_warning(t.workspace_id, v_to)));
end $$;

-- ───────────── disponibilidade e limite ─────────────
create function public.mcp_set_availability(p_token text, p_session text, p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections := public.agent_auth(p_token);
  s public.agent_sessions;
  v_note text := nullif(trim(p_note), '');
begin
  if p_status not in ('available', 'busy', 'near_limit', 'away') then
    raise exception 'status: available, busy, near_limit ou away' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 120 then
    raise exception 'nota até 120 caracteres' using errcode = '22023';
  end if;
  s := public.agent_touch_session(c, p_session, 'set_availability');
  update public.workspace_members set availability = p_status, availability_note = v_note, availability_at = now()
  where workspace_id = c.workspace_id and user_id = c.user_id;
  insert into public.task_events (workspace_id, task_id, user_id, agent_session_id, source, type, payload)
  values (c.workspace_id, null, c.user_id, s.id, 'agent_declared', 'availability_changed',
          jsonb_strip_nulls(jsonb_build_object('status', p_status, 'note', v_note)));
  return jsonb_build_object('ok', true, 'availability', p_status);
end $$;

-- ⚙ Ajustes: o dono do projeto define o limite de tarefas abertas por pessoa (null desliga).
create function public.set_wip_limit(p_workspace uuid, p_limit integer) returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.jwt_workspace() is not null then
    raise exception 'entre com sua conta' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id = p_workspace and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'só o dono do projeto muda o limite' using errcode = '42501';
  end if;
  if p_limit is not null and p_limit not between 1 and 20 then
    raise exception 'limite de 1 a 20 (ou vazio para desligar)' using errcode = '22023';
  end if;
  update public.workspaces set wip_limit = p_limit where id = p_workspace;
  return p_limit;
end $$;

-- Disponibilidade com mais de 12 h é considerada velha e some do briefing.
create function public.member_availability(m public.workspace_members) returns text
language sql stable set search_path = '' as $$
  select case when m.availability is not null and m.availability_at > now() - interval '12 hours'
              then m.availability || coalesce(': ' || m.availability_note, '') end
$$;
revoke execute on function public.member_availability(public.workspace_members) from public, anon, authenticated;

-- ───────────── briefing com novidades ─────────────

-- Uma linha legível por evento relevante para quem pede o briefing (null: não interessa).
create function public.briefing_line(c public.agent_connections, e public.task_events) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.tasks;
  v_task text;
  v_mine boolean;
  p jsonb := e.payload;
begin
  if e.task_id is not null then
    select * into t from public.tasks where id = e.task_id;
    v_task := '#' || t.number || ' ' || t.title;
    v_mine := t.assignee_id = c.user_id or t.created_by = c.user_id;
  end if;
  return case e.type
    when 'complete_task' then 'concluiu ' || v_task
    when 'status_changed' then case
      when p ->> 'to_status' = 'declined' and t.created_by = c.user_id then 'recusou ' || v_task || ': ' || coalesce(p ->> 'reason', '')
      when p ->> 'to_status' = 'in_review' then 'mandou para revisão ' || v_task
      when p ->> 'from_status' = 'awaiting_acceptance' and p ->> 'to_status' = 'backlog' and t.created_by = c.user_id then 'aceitou ' || v_task
    end
    when 'task_created' then case when (p ->> 'assignee_id')::uuid = c.user_id then 'criou para você ' || v_task end
    when 'task_sent' then case when (p ->> 'assignee_id')::uuid = c.user_id then 'passou para você ' || v_task end
    when 'comment_added' then case when v_mine then 'comentou em ' || v_task || ': ' || coalesce(p ->> 'text', '') end
    when 'dependency_done' then case when t.assignee_id = c.user_id then
      case when (p ->> 'all_done')::boolean then 'concluiu #' || (p ->> 'number') || '; ' || v_task || ' está liberada'
           else 'concluiu #' || (p ->> 'number') || '; ' || v_task || ' ainda espera outras' end end
    when 'task_blocked' then 'bloqueou ' || v_task || ': ' || coalesce(p ->> 'reason', '')
    when 'task_unblocked' then 'desbloqueou ' || v_task
    when 'availability_changed' then 'mudou disponibilidade: ' || (p ->> 'status') || coalesce(': ' || (p ->> 'note'), '')
    when 'context_updated' then
      coalesce(case p ->> 'action' when 'create' then 'criou' when 'delete' then 'apagou' when 'restore' then 'restaurou' end, 'atualizou')
      || ' o bloco ' || coalesce(p ->> 'block_title', '')
    when 'report_progress' then case when p ->> 'text' ~* '^(AGUARDANDO|LIBERA|BLOQUEADO|CONTRATO|HANDOFF)\M'
      then coalesce('#' || t.number || ': ', '') || (p ->> 'text') end
  end;
end $$;
revoke execute on function public.briefing_line(public.agent_connections, public.task_events) from public, anon, authenticated;

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
        select p.display_name || ' ' || l.line || ' (' || public.ago(e.occurred_at) || ')' as line, e.occurred_at as at
        from public.task_events e
        left join public.profiles p on p.id = e.user_id
        cross join lateral (select left(public.briefing_line(c, e), 200) as line) l
        where e.workspace_id = c.workspace_id and e.occurred_at > v_since
          and e.user_id is distinct from c.user_id and l.line is not null
        order by e.occurred_at desc limit 12
      ) x),
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

-- "há 5 min", "há 2 h", "há 3 d": o briefing é texto para o agente, sem datas ISO.
create function public.ago(p_at timestamptz) returns text
language sql stable set search_path = '' as $$
  select case
    when now() - p_at < interval '1 hour' then 'há ' || greatest(0, (extract(epoch from now() - p_at) / 60)::int) || ' min'
    when now() - p_at < interval '1 day' then 'há ' || (extract(epoch from now() - p_at) / 3600)::int || ' h'
    else 'há ' || (extract(epoch from now() - p_at) / 86400)::int || ' d'
  end
$$;
revoke execute on function public.ago(timestamptz) from public, anon, authenticated;

-- ───────────── contexto da tarefa: conclusão, bloqueio e quem depende ─────────────
create or replace function public.mcp_get_task_context(p_token text, p_session text, p_number integer, p_summary boolean default false)
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
    'blocked', t.blocked_reason,
    'prompt', t.prompt,
    'description', t.description,
    'acceptance_criteria', t.acceptance_criteria,
    'decline_reason', t.decline_reason,
    'links', (select jsonb_agg(l.kind || ': ' || l.ref) from public.task_links l where l.task_id = t.id),
    'depends_on', (select jsonb_agg('#' || d.number || ' ' || d.title || ' (' || d.status || ')')
                   from public.task_dependencies td join public.tasks d on d.id = td.depends_on_task_id
                   where td.task_id = t.id),
    'needed_by', (select jsonb_agg('#' || d.number || ' ' || d.title || ' (' || d.status || ')')
                  from public.task_dependencies td join public.tasks d on d.id = td.task_id
                  where td.depends_on_task_id = t.id),
    'completion', (select jsonb_strip_nulls(jsonb_build_object(
                            'by', (select display_name from public.profiles where id = e.user_id),
                            'summary', e.payload ->> 'summary',
                            'evidence', nullif(e.evidence, '[]'::jsonb),
                            'when', public.ago(e.occurred_at)))
                   from public.task_events e
                   where e.task_id = t.id and e.type = 'complete_task'
                   order by e.occurred_at desc limit 1),
    'project_summary', case when s.id is not null then
                         jsonb_build_object('title', s.title, 'content', left(s.content, 2000), 'truncated', char_length(s.content) > 2000) end,
    'recent_progress', (select jsonb_agg(e.payload ->> 'text')
                        from (select * from public.task_events
                              where task_id = t.id and type = 'report_progress'
                              order by occurred_at desc limit 5) e)
  ));
end $$;

-- ───────────── carga do time: com disponibilidade e limite ─────────────
create or replace function public.mcp_get_team_workload(p_token text, p_session text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.agent_connections := public.agent_auth(p_token);
begin
  perform public.agent_touch_session(c, p_session, 'get_team_workload');
  perform public.agent_require_coordinator(c);
  return coalesce((
    select jsonb_agg(person order by (person ->> 'you')::boolean desc, person ->> 'name')
    from (
      select jsonb_strip_nulls(jsonb_build_object(
        'name', p.display_name,
        'you', m.user_id = c.user_id,
        'auto_accept', m.auto_accept,
        'availability', public.member_availability(m),
        'over_limit', public.wip_warning(c.workspace_id, m.user_id),
        'open', (select jsonb_object_agg(status, n) from (
                   select t.status, count(*) n from public.tasks t
                   where t.workspace_id = c.workspace_id and t.assignee_id = m.user_id
                     and t.status in ('awaiting_acceptance', 'backlog', 'in_progress', 'in_review')
                   group by t.status) x),
        'tasks', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('number', t.number, 'title', t.title, 'status', t.status,
                                                     'blocked', t.blocked_reason)) order by t.status, t.number)
                  from (select * from public.tasks t
                        where t.workspace_id = c.workspace_id and t.assignee_id = m.user_id
                          and t.status in ('awaiting_acceptance', 'backlog', 'in_progress', 'in_review')
                        order by t.status, t.number limit 15) t),
        'ai_usage', case when not m.share_usage then to_jsonb('não compartilhado'::text) else (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'agent', u.agent_kind,
                   'day', u.day,
                   'tokens_today', u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens,
                   'five_hour_pct', case when u.primary_resets_at > now() then u.primary_used_pct end,
                   'five_hour_resets_at', case when u.primary_resets_at > now() then u.primary_resets_at end,
                   'week_pct', case when u.secondary_resets_at > now() then u.secondary_used_pct end,
                   'week_resets_at', case when u.secondary_resets_at > now() then u.secondary_resets_at end,
                   'limits_read_at', u.limits_observed_at)))
          from public.ai_usage u where u.workspace_id = c.workspace_id and u.user_id = m.user_id) end
      )) as person
      from public.workspace_members m join public.profiles p on p.id = m.user_id
      where m.workspace_id = c.workspace_id
    ) people
  ), '[]'::jsonb);
end $$;

-- ───────────── permissões ─────────────
revoke execute on function
  public.mcp_create_task(text, text, text, text, text, integer[]),
  public.mcp_set_dependencies(text, text, integer, integer[]),
  public.mcp_set_blocked(text, text, integer, text),
  public.mcp_handoff_task(text, text, integer, text, text),
  public.mcp_set_availability(text, text, text, text)
from public;
grant execute on function
  public.mcp_create_task(text, text, text, text, text, integer[]),
  public.mcp_set_dependencies(text, text, integer, integer[]),
  public.mcp_set_blocked(text, text, integer, text),
  public.mcp_handoff_task(text, text, integer, text, text),
  public.mcp_set_availability(text, text, text, text)
to anon, authenticated;
revoke execute on function public.set_wip_limit(uuid, integer) from public, anon;
grant execute on function public.set_wip_limit(uuid, integer) to authenticated;

create or replace function public.cooper_server_info() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('app', 'cooper', 'schema', 19)
$$;
