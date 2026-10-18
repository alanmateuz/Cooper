-- Sessões de tokens revogados não aparecem mais no status do time.
-- Revogar também encerra as sessões abertas daquela conexão.

create or replace function public.mcp_get_team_status(p_token text, p_session text) returns jsonb
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
            and not exists (select 1 from public.agent_connections ac where ac.id = s.agent_connection_id and ac.revoked_at is not null)
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

create function public.end_sessions_on_revoke() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.revoked_at is not null and old.revoked_at is null then
    update public.agent_sessions set ended_at = now() where agent_connection_id = new.id and ended_at is null;
  end if;
  return new;
end $$;
create trigger on_agent_connection_revoked after update of revoked_at on public.agent_connections
  for each row execute function public.end_sessions_on_revoke();

-- encerra sessões já abertas de conexões revogadas antes desta migração
update public.agent_sessions s set ended_at = now()
where s.ended_at is null
  and exists (select 1 from public.agent_connections ac where ac.id = s.agent_connection_id and ac.revoked_at is not null);
