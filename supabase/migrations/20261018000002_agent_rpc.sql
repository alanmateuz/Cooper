-- Cooper — Fase 2: tokens de agente e RPCs usadas pelo servidor MCP.
--
-- Decisão: em vez de trocar o token por um JWT numa Edge Function (exigiria
-- deploy e guardar o segredo JWT), cada ferramenta MCP chama uma função
-- SECURITY DEFINER que recebe o token, valida pelo hash e restringe tudo ao
-- workspace e ao usuário da conexão. Funções são chamadas com a chave anon.
-- Cobertas por tests/agent.test.ts (inclui isolamento entre workspaces).

-- ───────────── rate limit simples por conexão ─────────────
create table public.agent_rate (
  connection_id uuid primary key references public.agent_connections (id) on delete cascade,
  window_start timestamptz not null default now(),
  calls integer not null default 0
);
alter table public.agent_rate enable row level security; -- sem políticas: só funções definer acessam

-- ───────────── autenticação ─────────────
create function public.agent_auth(p_token text) returns public.agent_connections
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections;
  r public.agent_rate;
begin
  if p_token is null or p_token !~ '^coop_[0-9a-f]{48}$' then
    raise exception 'token inválido' using errcode = '28000';
  end if;

  select * into c from public.agent_connections
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and revoked_at is null;
  if not found then
    raise exception 'token inválido ou revogado' using errcode = '28000';
  end if;

  -- o dono do token precisa continuar membro do workspace
  if not exists (select 1 from public.workspace_members m where m.workspace_id = c.workspace_id and m.user_id = c.user_id) then
    raise exception 'token sem acesso ao workspace' using errcode = '42501';
  end if;

  -- 120 chamadas por minuto por conexão
  insert into public.agent_rate as ar (connection_id) values (c.id)
  on conflict (connection_id) do update set
    calls = case when ar.window_start < now() - interval '1 minute' then 1 else ar.calls + 1 end,
    window_start = case when ar.window_start < now() - interval '1 minute' then now() else ar.window_start end
  returning * into r;
  if r.calls > 120 then
    raise exception 'limite de chamadas excedido; tente em 1 minuto' using errcode = '54000';
  end if;

  update public.agent_connections set last_used_at = now() where id = c.id;
  return c;
end $$;
revoke execute on function public.agent_auth(text) from public, anon, authenticated;

-- Sessão do processo MCP (uma por cliente iniciado). Cria ou toca.
create function public.agent_touch_session(c public.agent_connections, p_client_session text, p_event text)
returns public.agent_sessions
language plpgsql security definer set search_path = '' as $$
declare
  s public.agent_sessions;
begin
  if p_client_session is null or char_length(p_client_session) not between 8 and 100 then
    raise exception 'client_session inválido' using errcode = '22023';
  end if;
  insert into public.agent_sessions as x (workspace_id, user_id, agent_connection_id, agent_kind, client_session_id, last_event_at, last_event_type)
  values (c.workspace_id, c.user_id, c.id, c.agent_kind, p_client_session, now(), p_event)
  on conflict (workspace_id, agent_kind, client_session_id) do update
    set last_event_at = now(), last_event_type = p_event, ended_at = null
    where x.user_id = c.user_id                     -- nunca toca sessão de outra pessoa
  returning * into s;
  if s.id is null then
    raise exception 'sessão pertence a outro usuário' using errcode = '42501';
  end if;
  return s;
end $$;
revoke execute on function public.agent_touch_session(public.agent_connections, text, text) from public, anon, authenticated;

create function public.agent_find_task(c public.agent_connections, p_number integer) returns public.tasks
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  select * into t from public.tasks where workspace_id = c.workspace_id and number = p_number;
  if not found then
    raise exception 'tarefa #% não existe neste workspace', p_number using errcode = 'P0002';
  end if;
  return t;
end $$;
revoke execute on function public.agent_find_task(public.agent_connections, integer) from public, anon, authenticated;

-- ───────────── ferramentas MCP ─────────────

-- 1. get_workspace_context
create function public.mcp_get_workspace_context(p_token text, p_session text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.agent_connections := public.agent_auth(p_token);
begin
  perform public.agent_touch_session(c, p_session, 'get_workspace_context');
  return jsonb_build_object(
    'workspace', (select name from public.workspaces where id = c.workspace_id),
    'repositories', coalesce((select jsonb_agg(r.owner || '/' || r.name || ' (padrão: ' || r.default_branch || ')')
                              from public.repositories r where r.workspace_id = c.workspace_id), '[]'::jsonb),
    'context', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'title', e.title, 'body', e.body) order by e.position)
                         from public.context_entries e where e.workspace_id = c.workspace_id), '[]'::jsonb),
    'approved_decisions', coalesce((select jsonb_agg(jsonb_build_object('title', d.title, 'body', d.body) order by d.created_at desc)
                                    from (select * from public.technical_decisions
                                          where workspace_id = c.workspace_id and status = 'approved'
                                          order by created_at desc limit 10) d), '[]'::jsonb)
  );
end $$;

-- 2. get_my_tasks: atribuídas a mim e não concluídas
create function public.mcp_get_my_tasks(p_token text, p_session text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.agent_connections := public.agent_auth(p_token);
begin
  perform public.agent_touch_session(c, p_session, 'get_my_tasks');
  return coalesce((
    select jsonb_agg(jsonb_build_object('number', t.number, 'title', t.title, 'status', t.status) order by t.status, t.number)
    from public.tasks t
    where t.workspace_id = c.workspace_id and t.assignee_id = c.user_id and t.status <> 'done'
  ), '[]'::jsonb);
end $$;

-- 3. get_task_context
create function public.mcp_get_task_context(p_token text, p_session text, p_number integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections := public.agent_auth(p_token);
  t public.tasks;
begin
  perform public.agent_touch_session(c, p_session, 'get_task_context');
  t := public.agent_find_task(c, p_number);
  return jsonb_build_object(
    'number', t.number,
    'title', t.title,
    'status', t.status,
    'assignee', (select display_name from public.profiles where id = t.assignee_id),
    'description', t.description,
    'acceptance_criteria', t.acceptance_criteria,
    'links', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'ref', l.ref, 'source', l.source))
                       from public.task_links l where l.task_id = t.id), '[]'::jsonb),
    'depends_on', coalesce((select jsonb_agg(jsonb_build_object('number', d.number, 'title', d.title, 'status', d.status))
                            from public.task_dependencies td join public.tasks d on d.id = td.depends_on_task_id
                            where td.task_id = t.id), '[]'::jsonb),
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('title', x.title, 'body', x.body, 'status', x.status))
                           from public.technical_decisions x where x.task_id = t.id and x.status <> 'rejected'), '[]'::jsonb),
    'recent_events', coalesce((select jsonb_agg(jsonb_build_object('at', e.occurred_at, 'source', e.source, 'type', e.type, 'text', e.payload ->> 'text'))
                               from (select * from public.task_events where task_id = t.id order by occurred_at desc limit 5) e), '[]'::jsonb)
  );
end $$;

-- 4. start_task
create function public.mcp_start_task(p_token text, p_session text, p_number integer, p_branch text default null) returns jsonb
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
    insert into public.task_links (workspace_id, task_id, kind, ref, source)
    values (c.workspace_id, t.id, 'branch', v_branch, 'agent_declared')
    on conflict (task_id, kind, ref) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'number', t.number, 'title', t.title, 'status', t.status);
end $$;

-- 5. report_progress
create function public.mcp_report_progress(
  p_token text, p_session text, p_text text,
  p_number integer default null, p_files text[] default null, p_tests jsonb default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections := public.agent_auth(p_token);
  s public.agent_sessions;
  v_task uuid;
  v_text text := trim(p_text);
  v_payload jsonb;
begin
  if v_text is null or char_length(v_text) not between 1 and 120 then
    raise exception 'texto de progresso deve ter de 1 a 120 caracteres' using errcode = '22023';
  end if;
  if p_files is not null and (cardinality(p_files) > 50 or exists (select 1 from unnest(p_files) f where char_length(f) > 300)) then
    raise exception 'lista de arquivos grande demais' using errcode = '22023';
  end if;
  if p_tests is not null and (jsonb_typeof(p_tests) <> 'object' or not (p_tests ?& array['command', 'passed'])
      or jsonb_typeof(p_tests -> 'passed') <> 'boolean' or char_length(p_tests ->> 'command') > 200) then
    raise exception 'tests deve ser {command, passed}' using errcode = '22023';
  end if;

  s := public.agent_touch_session(c, p_session, 'report_progress');
  v_task := case when p_number is null then s.current_task_id else (public.agent_find_task(c, p_number)).id end;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'text', v_text,
    'files', case when p_files is null then null else to_jsonb(p_files) end,
    'tests', case when p_tests is null then null
                  else jsonb_build_object('command', p_tests ->> 'command', 'passed', (p_tests ->> 'passed')::boolean) end
  ));

  update public.agent_sessions set activity_text = v_text, current_task_id = coalesce(v_task, current_task_id) where id = s.id;
  insert into public.task_events (workspace_id, task_id, user_id, agent_session_id, source, type, payload)
  values (c.workspace_id, v_task, c.user_id, s.id, 'agent_declared', 'report_progress', v_payload);

  return jsonb_build_object('ok', true);
end $$;

-- 6. get_team_status: o que os OUTROS estão fazendo (para evitar sobreposição)
create function public.mcp_get_team_status(p_token text, p_session text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.agent_connections := public.agent_auth(p_token);
begin
  perform public.agent_touch_session(c, p_session, 'get_team_status');
  return coalesce((
    select jsonb_agg(person order by person ->> 'name')
    from (
      select jsonb_build_object(
        'name', p.display_name,
        'sessions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'agent', s.agent_kind,
            'task', (select '#' || t.number || ' ' || t.title from public.tasks t where t.id = s.current_task_id),
            'activity', s.activity_text,
            'activity_source', 'agent_declared',
            'last_event_at', s.last_event_at,
            'observed_by_hooks', s.has_hooks
          ) order by s.last_event_at desc nulls last)
          from public.agent_sessions s
          where s.workspace_id = c.workspace_id and s.user_id = m.user_id
            and s.ended_at is null and s.last_event_at > now() - interval '2 hours'
        ), '[]'::jsonb),
        'git', (select jsonb_build_object('branch', g.branch, 'head', left(g.head_sha, 7), 'behind', g.behind,
                                          'uncommitted_files', g.dirty_files, 'observed_at', g.observed_at, 'source', 'local_git')
                from public.git_snapshots g where g.workspace_id = c.workspace_id and g.user_id = m.user_id
                order by g.observed_at desc limit 1),
        'tasks_in_progress', coalesce((select jsonb_agg('#' || t.number || ' ' || t.title order by t.number)
                                       from public.tasks t
                                       where t.workspace_id = c.workspace_id and t.assignee_id = m.user_id and t.status = 'in_progress'), '[]'::jsonb)
      ) as person
      from public.workspace_members m
      join public.profiles p on p.id = m.user_id
      where m.workspace_id = c.workspace_id and m.user_id <> c.user_id
    ) people
  ), '[]'::jsonb);
end $$;

-- Encerrar a sessão quando o processo MCP sai (melhor esforço).
create function public.mcp_end_session(p_token text, p_session text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.agent_connections := public.agent_auth(p_token);
begin
  update public.agent_sessions set ended_at = now()
  where workspace_id = c.workspace_id and user_id = c.user_id and agent_kind = c.agent_kind and client_session_id = p_session;
end $$;

-- ───────────── gestão de tokens (humanos logados) ─────────────
create function public.create_agent_token(p_workspace uuid, p_kind public.agent_kind, p_label text default '')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := 'coop_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_id uuid;
begin
  if auth.uid() is null or public.jwt_workspace() is not null then
    raise exception 'só usuários logados criam tokens' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workspace_members where workspace_id = p_workspace and user_id = auth.uid()) then
    raise exception 'você não é membro deste workspace' using errcode = '42501';
  end if;
  insert into public.agent_connections (workspace_id, user_id, agent_kind, label, token_hash, token_prefix)
  values (p_workspace, auth.uid(), p_kind, left(coalesce(p_label, ''), 60),
          encode(extensions.digest(v_token, 'sha256'), 'hex'), left(v_token, 9))
  returning id into v_id;
  -- o token em texto só existe nesta resposta
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

-- ───────────── permissões ─────────────
revoke execute on function
  public.mcp_get_workspace_context(text, text),
  public.mcp_get_my_tasks(text, text),
  public.mcp_get_task_context(text, text, integer),
  public.mcp_start_task(text, text, integer, text),
  public.mcp_report_progress(text, text, text, integer, text[], jsonb),
  public.mcp_get_team_status(text, text),
  public.mcp_end_session(text, text),
  public.create_agent_token(uuid, public.agent_kind, text)
from public;

grant execute on function
  public.mcp_get_workspace_context(text, text),
  public.mcp_get_my_tasks(text, text),
  public.mcp_get_task_context(text, text, integer),
  public.mcp_start_task(text, text, integer, text),
  public.mcp_report_progress(text, text, text, integer, text[], jsonb),
  public.mcp_get_team_status(text, text),
  public.mcp_end_session(text, text)
to anon, authenticated;

grant execute on function public.create_agent_token(uuid, public.agent_kind, text) to authenticated;
