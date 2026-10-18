-- Cooper — uso em dupla: convites por e-mail (sem envio de e-mail; o dono avisa a pessoa).
-- Quem foi convidado entra no widget com aquele e-mail e aceita.

create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  invited_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (workspace_id, email)
);
alter table public.workspace_invites enable row level security;

-- Membros veem os convites do workspace; o convidado vê os convites para o próprio e-mail.
create policy "membros e convidado veem convites" on public.workspace_invites for select to authenticated
  using (public.is_member(workspace_id) or email = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy "dono convida" on public.workspace_invites for insert to authenticated
  with check (public.is_owner(workspace_id) and invited_by = auth.uid() and accepted_at is null);
create policy "dono cancela convite" on public.workspace_invites for delete to authenticated
  using (public.is_owner(workspace_id));

-- O convidado aceita. Confere o e-mail do JWT, que vem do Supabase Auth.
create function public.accept_invite(p_invite uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  i public.workspace_invites;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or public.jwt_workspace() is not null then
    raise exception 'entre com sua conta para aceitar' using errcode = '42501';
  end if;
  select * into i from public.workspace_invites where id = p_invite and accepted_at is null;
  if not found or i.email <> v_email then
    raise exception 'convite não encontrado para este e-mail' using errcode = 'P0002';
  end if;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (i.workspace_id, auth.uid(), 'member')
  on conflict (workspace_id, user_id) do nothing;
  update public.workspace_invites set accepted_at = now() where id = i.id;
  return i.workspace_id;
end $$;
revoke execute on function public.accept_invite(uuid) from public, anon;
grant execute on function public.accept_invite(uuid) to authenticated;

-- Nome do workspace aparece para o convidado antes de aceitar.
create function public.my_pending_invites() returns table (id uuid, workspace_name text, invited_by_name text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, w.name, p.display_name, i.created_at
  from public.workspace_invites i
  join public.workspaces w on w.id = i.workspace_id
  left join public.profiles p on p.id = i.invited_by
  where i.accepted_at is null
    and i.email = lower(coalesce(auth.jwt() ->> 'email', ''))
    and auth.uid() is not null
    and not exists (select 1 from public.workspace_members m where m.workspace_id = i.workspace_id and m.user_id = auth.uid())
$$;
revoke execute on function public.my_pending_invites() from public, anon;
grant execute on function public.my_pending_invites() to authenticated;

alter publication supabase_realtime add table public.workspace_invites;
