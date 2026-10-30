-- Cooper 0.8 — integração com o GitHub.
--
-- O app de cada pessoa lê o GitHub (com o token dela, que fica só na máquina; sem token, só repositório público)
-- e entrega o que viu pela RPC github_sync:
-- 1. PRs do repositório do time: estado, CI (checks e status), revisão. Cada PR se liga às tarefas que têm a branch
--    dele como vínculo; vira também um vínculo "pr" da tarefa, com o link.
-- 2. Mudanças que importam viram eventos com origem "GitHub" na tarefa ligada: PR aberto, CI falhou ou passou,
--    revisão aprovada ou com mudanças pedidas, merge e fechamento.
-- 3. O acesso da própria pessoa ao repositório (escrita, leitura ou nenhum): o briefing avisa o time de quem não
--    consegue fazer push antes de alguém tropeçar nisso.
-- Os agentes veem os PRs no get_briefing e no get_task_context. Coberto por tests/sql/github.test.ts.

create table public.github_pull_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  repository_id uuid not null references public.repositories (id) on delete cascade,
  number integer not null check (number > 0),
  title text not null check (char_length(title) between 1 and 300),
  state text not null check (state in ('open', 'closed', 'merged')),
  draft boolean not null default false,
  head_branch text not null check (char_length(head_branch) between 1 and 200),
  base_branch text not null check (char_length(base_branch) between 1 and 200),
  head_sha text check (head_sha ~ '^[0-9a-f]{40}$'),
  author text check (char_length(author) <= 100),
  checks text not null default 'none' check (checks in ('success', 'failure', 'pending', 'none')),
  review text check (review in ('approved', 'changes_requested', 'pending')),
  url text not null check (url ~ '^https://github\.com/'),
  updated_at timestamptz not null,
  synced_at timestamptz not null default now(),
  unique (repository_id, number)
);
create index on public.github_pull_requests (workspace_id, state);
alter table public.github_pull_requests enable row level security;
create policy "membros veem PRs" on public.github_pull_requests for select to authenticated
  using (public.is_member(workspace_id));
alter publication supabase_realtime add table public.github_pull_requests;

alter table public.workspace_members
  add column repo_access text check (repo_access in ('write', 'read', 'none')),
  add column repo_access_at timestamptz;

-- Texto curto de um PR para os agentes: "#1 integracao → main · CI falhou · revisão pendente".
create function public.pr_line(r public.github_pull_requests) returns text
language sql immutable set search_path = '' as $$
  select '#' || r.number || ' ' || r.head_branch || ' → ' || r.base_branch
    || case r.state when 'merged' then ' · merge feito' when 'closed' then ' · fechado' else '' end
    || case when r.draft then ' · rascunho' else '' end
    || case r.checks when 'success' then ' · CI ok' when 'failure' then ' · CI falhou' when 'pending' then ' · CI rodando' else '' end
    || case r.review when 'approved' then ' · aprovado' when 'changes_requested' then ' · pediram mudanças'
                     when 'pending' then ' · revisão pendente' else '' end
$$;

-- Tarefas ligadas a um PR: as que têm a branch dele como vínculo.
create function public.pr_tasks(r public.github_pull_requests) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct l.task_id from public.task_links l
  where l.workspace_id = r.workspace_id and l.kind = 'branch' and l.ref = r.head_branch
$$;
revoke execute on function public.pr_tasks(public.github_pull_requests) from public, anon, authenticated;

-- Entrega do app: PRs lidos do GitHub (lista JSON) e o acesso de quem leu ('write', 'read', 'none' ou null se não deu
-- para saber, como sem token). Grava, liga às tarefas e registra os eventos de mudança.
create function public.github_sync(p_workspace uuid, p_prs jsonb, p_access text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_repo public.repositories;
  x jsonb;
  old_pr public.github_pull_requests;
  pr public.github_pull_requests;
  v_change text;
  v_count integer := 0;
  v_events integer := 0;
begin
  if auth.uid() is null or public.jwt_workspace() is not null then
    raise exception 'entre com sua conta' using errcode = '42501';
  end if;
  if not public.is_member(p_workspace) then
    raise exception 'você não é membro deste workspace' using errcode = '42501';
  end if;
  if p_access is not null and p_access not in ('write', 'read', 'none') then
    raise exception 'acesso: write, read ou none' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_prs, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_prs, '[]'::jsonb)) > 100 then
    raise exception 'até 100 PRs por entrega' using errcode = '22023';
  end if;
  select * into v_repo from public.repositories where workspace_id = p_workspace order by created_at limit 1;
  if not found then
    raise exception 'o projeto ainda não tem repositório' using errcode = '22023';
  end if;

  if p_access is not null then
    update public.workspace_members set repo_access = p_access, repo_access_at = now()
    where workspace_id = p_workspace and user_id = auth.uid();
  end if;

  for x in select * from jsonb_array_elements(coalesce(p_prs, '[]'::jsonb)) loop
    select * into old_pr from public.github_pull_requests where repository_id = v_repo.id and number = (x ->> 'number')::int;
    -- leitura mais velha que a gravada (outra pessoa sincronizou depois): ignora
    if found and old_pr.updated_at > (x ->> 'updated_at')::timestamptz then
      continue;
    end if;
    insert into public.github_pull_requests as g (workspace_id, repository_id, number, title, state, draft, head_branch, base_branch,
                                                  head_sha, author, checks, review, url, updated_at, synced_at)
    values (p_workspace, v_repo.id, (x ->> 'number')::int, left(x ->> 'title', 300), x ->> 'state', coalesce((x ->> 'draft')::boolean, false),
            x ->> 'head_branch', x ->> 'base_branch', x ->> 'head_sha', left(x ->> 'author', 100), coalesce(x ->> 'checks', 'none'),
            x ->> 'review', x ->> 'url', (x ->> 'updated_at')::timestamptz, now())
    on conflict (repository_id, number) do update set
      title = excluded.title, state = excluded.state, draft = excluded.draft, head_branch = excluded.head_branch,
      base_branch = excluded.base_branch, head_sha = excluded.head_sha, author = excluded.author, checks = excluded.checks,
      review = excluded.review, url = excluded.url, updated_at = excluded.updated_at, synced_at = now()
    returning * into pr;
    v_count := v_count + 1;

    -- o que mudou e merece aviso (null: nada)
    v_change := case
      when old_pr.id is null and pr.state = 'open' then 'opened'
      when pr.state = 'merged' and old_pr.state is distinct from 'merged' then 'merged'
      when pr.state = 'closed' and old_pr.state is distinct from 'closed' and old_pr.id is not null then 'closed'
      when pr.state = 'open' and pr.checks in ('failure', 'success') and old_pr.checks is distinct from pr.checks then 'checks_' || pr.checks
      when pr.state = 'open' and pr.review in ('approved', 'changes_requested') and old_pr.review is distinct from pr.review then pr.review
    end;
    if old_pr.id is null then
      old_pr := null;
    end if;

    -- vínculo "pr" nas tarefas da branch, e o evento
    insert into public.task_links (workspace_id, task_id, kind, ref, url, source)
    select p_workspace, t, 'pr', '#' || pr.number, pr.url, 'github' from public.pr_tasks(pr) t
    on conflict (task_id, kind, ref) do nothing;
    if v_change is not null then
      insert into public.task_events (workspace_id, task_id, user_id, source, type, payload)
      select p_workspace, t, null, 'github', 'pr_update',
             jsonb_build_object('pr', pr.number, 'change', v_change, 'branch', pr.head_branch, 'title', left(pr.title, 200))
      from public.pr_tasks(pr) t;
      get diagnostics v_events = row_count;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'pull_requests', v_count);
end $$;
revoke execute on function public.github_sync(uuid, jsonb, text) from public, anon;
grant execute on function public.github_sync(uuid, jsonb, text) to authenticated;

-- ───────────── agentes: briefing e contexto da tarefa ─────────────

-- briefing_line da 0019 + eventos do GitHub.
create or replace function public.briefing_line(c public.agent_connections, e public.task_events) returns text
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
    when 'pr_update' then 'PR #' || (p ->> 'pr') || ' (' || v_task || '): ' || case p ->> 'change'
      when 'opened' then 'aberto'
      when 'merged' then 'merge feito'
      when 'closed' then 'fechado sem merge'
      when 'checks_failure' then 'CI falhou'
      when 'checks_success' then 'CI passou'
      when 'approved' then 'aprovado'
      when 'changes_requested' then 'pediram mudanças'
      else p ->> 'change' end
  end;
end $$;

-- Quem fala no since_last: a pessoa, ou "GitHub" quando o evento veio de lá.
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
        select coalesce(p.display_name, case when e.source = 'github' then 'GitHub' else 'Alguém' end)
               || ' ' || l.line || ' (' || public.ago(e.occurred_at) || ')' as line, e.occurred_at as at
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

-- get_task_context da 0019 + PRs da branch da tarefa.
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
    'links', (select jsonb_agg(l.kind || ': ' || l.ref) from public.task_links l where l.task_id = t.id and l.kind <> 'pr'),
    'pull_requests', (select jsonb_agg(public.pr_line(r) || ' · ' || r.url order by r.number desc)
                      from public.github_pull_requests r
                      where r.workspace_id = t.workspace_id
                        and r.head_branch in (select l.ref from public.task_links l where l.task_id = t.id and l.kind = 'branch')),
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

create or replace function public.cooper_server_info() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('app', 'cooper', 'schema', 20)
$$;
