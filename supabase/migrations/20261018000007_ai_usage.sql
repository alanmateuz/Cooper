-- Cooper — nova direção, etapa 3: uso de IA nos perfis.
--
-- O app desktop lê, só localmente, os JSONL do Claude Code e do Codex e extrai apenas números
-- (tokens, percentual de limite, reinício) e o nome do modelo. Nada de prompt, resposta ou código.
-- Compartilhar com o time é opcional e desligado por padrão; o banco recusa uso de quem não ligou,
-- e desligar apaga o que já tinha sido enviado.
-- Coberto por tests/usage.test.ts.

alter table public.workspace_members add column share_usage boolean not null default false;

-- Uso do dia, uma linha por pessoa e agente (sobrescrita a cada leitura; sem histórico).
create table public.ai_usage (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  agent_kind public.agent_kind not null,
  day date not null,
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cache_read_tokens bigint not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens bigint not null default 0 check (cache_write_tokens >= 0),
  models text[] not null default '{}' check (cardinality(models) <= 10 and array_to_string(models, ',') ~ '^[A-Za-z0-9._:,-]{0,900}$'),
  -- limites (hoje só o Codex informa): janela curta (5 h) e longa (semana)
  primary_used_pct numeric(5, 2) check (primary_used_pct between 0 and 100),
  primary_window_minutes integer check (primary_window_minutes > 0),
  primary_resets_at timestamptz,
  secondary_used_pct numeric(5, 2) check (secondary_used_pct between 0 and 100),
  secondary_window_minutes integer check (secondary_window_minutes > 0),
  secondary_resets_at timestamptz,
  observed_at timestamptz not null default now(),
  primary key (workspace_id, user_id, agent_kind)
);
alter table public.ai_usage enable row level security;

create function public.shares_usage(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid() and m.share_usage
  ) and public.jwt_workspace() is null
$$;
revoke execute on function public.shares_usage(uuid) from public, anon;
grant execute on function public.shares_usage(uuid) to authenticated;

create policy "membros veem uso compartilhado" on public.ai_usage for select to authenticated
  using (public.is_member(workspace_id));
create policy "gravar o próprio uso, se compartilhar" on public.ai_usage for insert to authenticated
  with check (user_id = auth.uid() and public.shares_usage(workspace_id));
create policy "atualizar o próprio uso, se compartilhar" on public.ai_usage for update to authenticated
  using (user_id = auth.uid() and public.shares_usage(workspace_id))
  with check (user_id = auth.uid() and public.shares_usage(workspace_id));
create policy "apagar o próprio uso" on public.ai_usage for delete to authenticated
  using (user_id = auth.uid());

-- Ligar/desligar o compartilhamento (⚙ → Privacidade). Desligar apaga o uso já enviado.
create function public.set_usage_sharing(p_workspace uuid, p_on boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.jwt_workspace() is not null then
    raise exception 'entre com sua conta' using errcode = '42501';
  end if;
  update public.workspace_members set share_usage = p_on
  where workspace_id = p_workspace and user_id = auth.uid();
  if not found then
    raise exception 'você não é membro deste workspace' using errcode = '42501';
  end if;
  if not p_on then
    delete from public.ai_usage where workspace_id = p_workspace and user_id = auth.uid();
  end if;
  return p_on;
end $$;
revoke execute on function public.set_usage_sharing(uuid, boolean) from public, anon;
grant execute on function public.set_usage_sharing(uuid, boolean) to authenticated;

alter publication supabase_realtime add table public.ai_usage;
