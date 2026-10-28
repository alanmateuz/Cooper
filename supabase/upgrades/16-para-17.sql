-- Hooks do Claude Code: presença "Executando" observada, não declarada.
-- O script de hook (cooper-hook.js) manda só o nome do evento. Nada de prompt, ferramenta, arquivo ou caminho.
-- O evento marca a sessão MCP aberta mais recente da mesma conexão (has_hooks = true), para a presença
-- e a atividade declarada ficarem na mesma linha do cartão. Sem sessão aberta, não faz nada.

create function public.mcp_hook_event(p_token text, p_event text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.agent_connections := public.agent_auth(p_token);
  sid uuid;
begin
  if p_event is null or p_event not in ('user_prompt_submit', 'pre_tool_use', 'post_tool_use', 'stop') then
    raise exception 'evento de hook inválido' using errcode = '22023';
  end if;
  select s.id into sid from public.agent_sessions s
   where s.agent_connection_id = c.id and s.ended_at is null
     and s.last_event_at > now() - interval '12 hours'
   order by s.last_event_at desc
   limit 1;
  if sid is null then
    return jsonb_build_object('ok', false, 'reason', 'nenhuma sessão aberta');
  end if;
  update public.agent_sessions
     set has_hooks = true, last_event_at = now(), last_event_type = p_event
   where id = sid;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.mcp_hook_event(text, text) from public;
grant execute on function public.mcp_hook_event(text, text) to anon, authenticated;

create or replace function public.cooper_server_info() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('app', 'cooper', 'schema', 17)
$$;
