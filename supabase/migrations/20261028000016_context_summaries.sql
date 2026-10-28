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
