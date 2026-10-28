-- Cooper — modo coordenador da IA e aceite automático (duas chaves por pessoa, em ⚙ Ajustes).
--
-- 1. ai_coordinator: a IA desta pessoa vê a carga do time (tarefas abertas e, de quem compartilha, o uso de IA),
--    redistribui tarefas, edita título/prompt/descrição de qualquer tarefa e inicia ou conclui qualquer tarefa.
--    Desligado (padrão): a IA só inicia e conclui tarefas do próprio dono ou sem responsável.
--    O uso de IA de outra pessoa continua visível só se ela ligou "Compartilhar uso".
-- 2. auto_accept: tarefas enviadas a esta pessoa já entram aceitas (sem "aguardando aceite"), inclusive quando
--    o prompt muda. Ninguém aceita por outra pessoa: o aceite automático é escolha de quem recebe.
-- Coberto por tests/coordinator.test.ts.

alter table public.workspace_members
  add column ai_coordinator boolean not null default false,
  add column auto_accept boolean not null default false;

create function public.member_flag(p_ws uuid, p_user uuid, p_flag text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case p_flag when 'ai_coordinator' then m.ai_coordinator when 'auto_accept' then m.auto_accept end
    from public.workspace_members m where m.workspace_id = p_ws and m.user_id = p_user
  ), false)
$$;
revoke execute on function public.member_flag(uuid, uuid, text) from public, anon, authenticated;

-- A ação vem de um agente cujo dono ligou o modo coordenador?
create function public.acting_coordinator(p_ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is null
     and nullif(current_setting('cooper.actor', true), '') is not null
     and public.member_flag(p_ws, public.current_actor(), 'ai_coordinator')
$$;
revoke execute on function public.acting_coordinator(uuid) from public, anon, authenticated;

-- ⚙ Ajustes: cada pessoa liga ou desliga as próprias chaves.
create function public.set_member_option(p_workspace uuid, p_option text, p_on boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.jwt_workspace() is not null then
    raise exception 'entre com sua conta' using errcode = '42501';
  end if;
  if p_option not in ('ai_coordinator', 'auto_accept') then
    raise exception 'opção desconhecida' using errcode = '22023';
  end if;
  update public.workspace_members set
    ai_coordinator = case when p_option = 'ai_coordinator' then p_on else ai_coordinator end,
    auto_accept = case when p_option = 'auto_accept' then p_on else auto_accept end
  where workspace_id = p_workspace and user_id = auth.uid();
  if not found then
    raise exception 'você não é membro deste workspace' using errcode = '42501';
  end if;
  return p_on;
end $$;
revoke execute on function public.set_member_option(uuid, text, boolean) from public, anon;
grant execute on function public.set_member_option(uuid, text, boolean) to authenticated;

-- ───────────── aceite automático ─────────────
create or replace function public.task_acceptance_on_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_task_assignee(new.workspace_id, new.assignee_id);
  new.declined_at := null;
  new.decline_reason := null;
  if new.assignee_id is null or new.assignee_id = new.created_by
     or public.member_flag(new.workspace_id, new.assignee_id, 'auto_accept') then
    if new.status in ('awaiting_acceptance', 'declined') then
      new.status := 'backlog';
    end if;
    new.accepted_at := now();
  else
    new.status := 'awaiting_acceptance';
    new.accepted_at := null;
  end if;
  return new;
end $$;

create or replace function public.guard_task_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_actor();
begin
  new.updated_at := now();
  new.number := old.number;
  new.workspace_id := old.workspace_id;
  new.created_by := old.created_by;

  if new.assignee_id is distinct from old.assignee_id then
    perform public.assert_task_assignee(new.workspace_id, new.assignee_id);
    new.declined_at := null;
    new.decline_reason := null;
    if new.assignee_id is null or new.assignee_id = v_actor
       or public.member_flag(new.workspace_id, new.assignee_id, 'auto_accept') then
      new.accepted_at := now();
      if new.status in ('awaiting_acceptance', 'declined') then
        new.status := 'backlog';
      end if;
    else
      new.status := 'awaiting_acceptance';
      new.accepted_at := null;
    end if;
    return new;
  end if;

  new.accepted_at := old.accepted_at;
  new.declined_at := old.declined_at;
  if new.status = old.status then
    new.decline_reason := old.decline_reason;
    return new;
  end if;

  if old.status = 'awaiting_acceptance' then
    if v_actor is distinct from old.assignee_id then
      raise exception 'só quem recebeu a tarefa pode aceitar ou recusar' using errcode = '42501';
    end if;
    if new.status = 'declined' then
      new.decline_reason := nullif(trim(new.decline_reason), '');
      if new.decline_reason is null or char_length(new.decline_reason) > 500 then
        raise exception 'recusar exige um motivo (até 500 caracteres)' using errcode = '22023';
      end if;
      new.declined_at := now();
    elsif new.status = 'backlog' then
      new.accepted_at := now();
      new.decline_reason := null;
    else
      raise exception 'aceite a tarefa antes de mudar o status' using errcode = '22023';
    end if;
  elsif old.status = 'declined' then
    if new.status <> 'awaiting_acceptance' then
      raise exception 'tarefa recusada: reenvie ou troque o responsável' using errcode = '22023';
    end if;
    new.declined_at := null;
    new.decline_reason := null;
    if public.member_flag(new.workspace_id, new.assignee_id, 'auto_accept') then
      new.status := 'backlog';
      new.accepted_at := now();
    end if;
  elsif new.status in ('awaiting_acceptance', 'declined') then
    raise exception 'para enviar a tarefa a alguém, troque o responsável' using errcode = '22023';
  else
    new.decline_reason := old.decline_reason;
  end if;
  return new;
end $$;

-- Edição: criador, dono do projeto ou IA coordenadora. Prompt novo pede novo aceite, salvo aceite automático.
create or replace function public.guard_task_edit() returns trigger
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
  if v_actor is distinct from old.created_by
     and not public.acting_coordinator(old.workspace_id)
     and not exists (
       select 1 from public.workspace_members m
       where m.workspace_id = old.workspace_id and m.user_id = v_actor and m.role = 'owner'
     ) then
    raise exception 'só quem criou a tarefa, o dono do projeto ou uma IA no modo coordenador edita título, prompt, descrição e critérios'
      using errcode = '42501';
  end if;
  new.prompt := nullif(trim(new.prompt), '');
  new.description := nullif(trim(new.description), '');
  new.acceptance_criteria := nullif(trim(new.acceptance_criteria), '');
  if new.prompt is distinct from old.prompt
     and old.status in ('backlog', 'in_progress', 'in_review')
     and new.assignee_id is not distinct from old.assignee_id
     and new.assignee_id is not null and new.assignee_id is distinct from v_actor
     and not public.member_flag(old.workspace_id, new.assignee_id, 'auto_accept') then
    new.status := 'awaiting_acceptance';
    new.accepted_at := null;
  end if;
  return new;
end $$;

-- Eventos: envio aceito automaticamente também aparece como envio (com auto_accepted).
create or replace function public.log_task_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_agent boolean := auth.uid() is null and nullif(current_setting('cooper.actor', true), '') is not null;
  v_source public.event_source := case when v_agent then 'agent_declared' else 'user' end;
  v_session uuid := case when v_agent then nullif(current_setting('cooper.session', true), '')::uuid end;
  v_actor uuid := public.current_actor();
  v_fields text[];
  v_sent boolean;
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (workspace_id, task_id, user_id, agent_session_id, source, type, payload)
    values (new.workspace_id, new.id, v_actor, v_session, v_source, 'task_created',
            jsonb_strip_nulls(jsonb_build_object('assignee_id', new.assignee_id, 'to_status', new.status,
              'auto_accepted', case when new.assignee_id is distinct from new.created_by and new.status <> 'awaiting_acceptance'
                                         and new.assignee_id is not null then true end)));
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

  v_sent := new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null
            and new.assignee_id is distinct from v_actor;
  if v_sent then
    insert into public.task_events (workspace_id, task_id, user_id, agent_session_id, source, type, payload)
    values (new.workspace_id, new.id, v_actor, v_session, v_source, 'task_sent',
            jsonb_strip_nulls(jsonb_build_object('assignee_id', new.assignee_id,
              'auto_accepted', case when new.status <> 'awaiting_acceptance' then true end)));
  elsif new.status <> old.status then
    insert into public.task_events (workspace_id, task_id, user_id, agent_session_id, source, type, payload)
    values (new.workspace_id, new.id, v_actor, v_session, v_source, 'status_changed',
            jsonb_strip_nulls(jsonb_build_object(
              'from_status', old.status, 'to_status', new.status,
              'reason', case when new.status = 'declined' then new.decline_reason end)));
  end if;
  return null;
end $$;

revoke execute on function public.task_acceptance_on_insert(), public.guard_task_update(), public.guard_task_edit(), public.log_task_change()
  from public, anon, authenticated;

-- ───────────── trava: iniciar e concluir ─────────────
create function public.agent_can_work_on(c public.agent_connections, t public.tasks) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if t.assignee_id is not null and t.assignee_id <> c.user_id and not public.member_flag(c.workspace_id, c.user_id, 'ai_coordinator') then
    raise exception 'a tarefa #% é de %; só ela (ou uma IA no modo coordenador) inicia ou conclui',
      t.number, (select display_name from public.profiles where id = t.assignee_id) using errcode = '42501';
  end if;
end $$;
revoke execute on function public.agent_can_work_on(public.agent_connections, public.tasks) from public, anon, authenticated;

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
    insert into public.task_links (workspace_id, task_id, kind, ref, source)
    values (c.workspace_id, t.id, 'branch', v_branch, 'agent_declared')
    on conflict (task_id, kind, ref) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'number', t.number, 'title', t.title, 'status', t.status);
end $$;

create or replace function public.mcp_complete_task(
  p_token text, p_session text, p_summary text, p_number integer default null, p_evidence text[] default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections := public.agent_auth(p_token);
  s public.agent_sessions;
  t public.tasks;
  v_summary text := trim(p_summary);
begin
  if v_summary is null or char_length(v_summary) not between 1 and 1000 then
    raise exception 'resumo deve ter de 1 a 1000 caracteres' using errcode = '22023';
  end if;
  if p_evidence is not null and (cardinality(p_evidence) > 10 or exists (select 1 from unnest(p_evidence) e where char_length(e) not between 1 and 300)) then
    raise exception 'evidências: até 10 itens de até 300 caracteres' using errcode = '22023';
  end if;
  s := public.agent_touch_session(c, p_session, 'complete_task');
  if p_number is null then
    select * into t from public.tasks where id = s.current_task_id;
    if not found then
      raise exception 'informe o número da tarefa' using errcode = '22023';
    end if;
  else
    t := public.agent_find_task(c, p_number);
  end if;
  if t.status = 'done' then
    raise exception 'tarefa #% já está concluída', t.number using errcode = '22023';
  end if;
  if t.status in ('awaiting_acceptance', 'declined') then
    raise exception 'tarefa #% não foi aceita', t.number using errcode = '22023';
  end if;
  perform public.agent_can_work_on(c, t);

  update public.tasks set status = 'done' where id = t.id returning * into t;
  insert into public.task_events (workspace_id, task_id, user_id, agent_session_id, source, type, payload, evidence)
  values (c.workspace_id, t.id, c.user_id, s.id, 'agent_declared', 'complete_task',
          jsonb_build_object('summary', v_summary), coalesce(to_jsonb(p_evidence), '[]'::jsonb));
  update public.agent_sessions set current_task_id = null, activity_text = left('Concluiu #' || t.number || ' ' || t.title, 120)
  where id = s.id;

  return jsonb_build_object('ok', true, 'number', t.number, 'status', t.status, 'source', 'agent_declared');
end $$;

-- ───────────── ferramentas novas ─────────────
create function public.agent_find_member(c public.agent_connections, p_who text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_who text := lower(nullif(trim(p_who), ''));
  v_matches uuid[];
  v_members text;
begin
  if v_who is null then
    raise exception 'informe o nome ou e-mail de um membro' using errcode = '22023';
  end if;
  if v_who in ('eu', 'me', 'mim') then
    return c.user_id;
  end if;
  select array_agg(m.user_id) into v_matches
  from public.workspace_members m
  join public.profiles p on p.id = m.user_id
  join auth.users u on u.id = m.user_id
  where m.workspace_id = c.workspace_id
    and (lower(u.email) = v_who or position(v_who in lower(p.display_name)) > 0);
  if coalesce(cardinality(v_matches), 0) <> 1 then
    select string_agg(p.display_name, ', ' order by p.display_name) into v_members
    from public.workspace_members m join public.profiles p on p.id = m.user_id where m.workspace_id = c.workspace_id;
    raise exception '% para "%". Membros: %',
      case when v_matches is null then 'nenhum membro encontrado' else 'mais de um membro encontrado' end, p_who, v_members
      using errcode = '22023';
  end if;
  return v_matches[1];
end $$;
revoke execute on function public.agent_find_member(public.agent_connections, text) from public, anon, authenticated;

create function public.agent_require_coordinator(c public.agent_connections) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.member_flag(c.workspace_id, c.user_id, 'ai_coordinator') then
    raise exception 'modo coordenador desligado: peça ao usuário para ligar em Ajustes → Agentes no Cooper' using errcode = '42501';
  end if;
end $$;
revoke execute on function public.agent_require_coordinator(public.agent_connections) from public, anon, authenticated;

-- Carga do time (modo coordenador): tarefas abertas de cada um e, de quem compartilha, o uso de IA de hoje.
create function public.mcp_get_team_workload(p_token text, p_session text) returns jsonb
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
        'open', (select jsonb_object_agg(status, n) from (
                   select t.status, count(*) n from public.tasks t
                   where t.workspace_id = c.workspace_id and t.assignee_id = m.user_id
                     and t.status in ('awaiting_acceptance', 'backlog', 'in_progress', 'in_review')
                   group by t.status) x),
        'tasks', (select jsonb_agg(jsonb_build_object('number', t.number, 'title', t.title, 'status', t.status) order by t.status, t.number)
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

-- Redistribuir (modo coordenador). Quem recebe aceita, a menos que tenha ligado o aceite automático.
create function public.mcp_assign_task(p_token text, p_session text, p_number integer, p_assignee text) returns jsonb
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
  return jsonb_build_object('ok', true, 'number', t.number, 'status', t.status,
                            'assignee', (select display_name from public.profiles where id = v_to),
                            'auto_accepted', t.status <> 'awaiting_acceptance' and v_to <> c.user_id);
end $$;

-- Editar título, prompt, descrição e critérios (quem criou, dono do projeto ou IA coordenadora; o trigger confere).
create function public.mcp_update_task(
  p_token text, p_session text, p_number integer,
  p_title text default null, p_prompt text default null, p_description text default null, p_acceptance_criteria text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections := public.agent_auth(p_token);
  t public.tasks;
begin
  perform public.agent_touch_session(c, p_session, 'update_task');
  t := public.agent_find_task(c, p_number);
  if p_title is not null and char_length(trim(p_title)) not between 1 and 200 then
    raise exception 'título deve ter de 1 a 200 caracteres' using errcode = '22023';
  end if;
  update public.tasks set
    title = coalesce(trim(p_title), title),
    prompt = coalesce(p_prompt, prompt),
    description = coalesce(p_description, description),
    acceptance_criteria = coalesce(p_acceptance_criteria, acceptance_criteria)
  where id = t.id returning * into t;
  return jsonb_build_object('ok', true, 'number', t.number, 'status', t.status,
                            'reaccept', t.status = 'awaiting_acceptance');
end $$;

revoke execute on function
  public.mcp_get_team_workload(text, text),
  public.mcp_assign_task(text, text, integer, text),
  public.mcp_update_task(text, text, integer, text, text, text, text)
from public;
grant execute on function
  public.mcp_get_team_workload(text, text),
  public.mcp_assign_task(text, text, integer, text),
  public.mcp_update_task(text, text, integer, text, text, text, text)
to anon, authenticated;

create or replace function public.cooper_server_info() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('app', 'cooper', 'schema', 13)
$$;
