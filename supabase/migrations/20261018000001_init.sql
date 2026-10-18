-- Cooper — esquema inicial (Fase 1)
-- Regra geral: tudo pertence a um workspace; RLS libera só para membros dele.
-- Tokens de agente (Fase 2) serão JWTs com sub = usuário e claim `cooper_ws`
-- restringindo a um único workspace; as funções abaixo já respeitam essa claim.

create extension if not exists pgcrypto;

-- ───────────── enums (espelhados em packages/shared/src/enums.ts) ─────────────
create type public.event_source as enum ('user', 'agent_declared', 'agent_hook', 'local_git', 'github', 'tests');
create type public.task_status as enum ('backlog', 'in_progress', 'in_review', 'done');
create type public.agent_kind as enum ('claude_code', 'codex', 'other');
create type public.task_link_kind as enum ('branch', 'commit', 'pr');
create type public.member_role as enum ('owner', 'member');
create type public.decision_status as enum ('proposed', 'approved', 'rejected');
create type public.context_kind as enum ('summary', 'architecture', 'convention');

-- ───────────── tabelas ─────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  avatar_color text not null default '#6366f1' check (avatar_color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null default auth.uid() references auth.users (id),
  task_seq integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on public.workspace_members (user_id);

create table public.repositories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null default 'github' check (provider = 'github'),
  owner text not null,
  name text not null,
  default_branch text not null default 'main',
  created_at timestamptz not null default now(),
  unique (workspace_id, owner, name)
);

create table public.agent_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  agent_kind public.agent_kind not null,
  label text not null default '',
  token_hash text not null unique,            -- sha256 do token; o token em si nunca é guardado
  token_prefix text not null,                 -- primeiros caracteres, só para identificação visual
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  number integer not null,
  title text not null check (char_length(title) between 1 and 200),
  description text check (char_length(description) <= 5000),
  acceptance_criteria text check (char_length(acceptance_criteria) <= 5000),
  status public.task_status not null default 'backlog',
  assignee_id uuid references auth.users (id) on delete set null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, number)
);
create index on public.tasks (workspace_id, status);

create table public.task_dependencies (
  task_id uuid not null references public.tasks (id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);

create table public.task_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  kind public.task_link_kind not null,
  ref text not null check (char_length(ref) between 1 and 200),
  url text,
  source public.event_source not null default 'user',
  created_at timestamptz not null default now(),
  unique (task_id, kind, ref)
);

create table public.agent_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  agent_connection_id uuid references public.agent_connections (id) on delete set null,
  agent_kind public.agent_kind not null,
  client_session_id text not null,            -- session_id que o cliente (Claude Code/Codex) informa
  has_hooks boolean not null default false,   -- só sessões com hooks têm presença observada
  current_task_id uuid references public.tasks (id) on delete set null,
  activity_text text check (char_length(activity_text) <= 120),
  started_at timestamptz not null default now(),
  last_event_at timestamptz,
  last_event_type text,
  ended_at timestamptz,
  unique (workspace_id, agent_kind, client_session_id)
);
create index on public.agent_sessions (workspace_id, last_event_at desc);

create table public.task_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  agent_session_id uuid references public.agent_sessions (id) on delete set null,
  source public.event_source not null,
  type text not null check (type ~ '^[a-z_]{1,40}$'),
  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 8192),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array')
);
create index on public.task_events (workspace_id, occurred_at desc);
create index on public.task_events (task_id, occurred_at desc);

create table public.context_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind public.context_kind not null default 'convention',
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) <= 4000),
  position integer not null default 0,
  updated_by uuid default auth.uid() references auth.users (id),
  updated_at timestamptz not null default now()
);

create table public.technical_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (char_length(body) <= 4000),
  status public.decision_status not null default 'proposed',
  source public.event_source not null default 'user',
  proposed_by uuid default auth.uid() references auth.users (id),
  decided_by uuid references auth.users (id),
  task_id uuid references public.tasks (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- Estado atual do git local de cada pessoa por repositório (upsert pelo app desktop).
-- O histórico de mudanças vai para task_events com source = 'local_git'.
create table public.git_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  repository_id uuid not null references public.repositories (id) on delete cascade,
  branch text,
  head_sha text check (head_sha ~ '^[0-9a-f]{40}$'),
  ahead integer check (ahead >= 0),
  behind integer check (behind >= 0),
  dirty_files_count integer not null default 0 check (dirty_files_count >= 0),
  dirty_files text[],                          -- null quando o membro desliga o envio de nomes de arquivo
  observed_at timestamptz not null default now(),
  unique (user_id, repository_id)
);

-- ───────────── funções auxiliares ─────────────

-- Workspace ao qual o JWT atual está restrito (tokens de agente), ou null.
create function public.jwt_workspace() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'cooper_ws', '')::uuid
$$;

-- O usuário atual é membro de `ws` (e o JWT, se restrito, aponta para `ws`)?
create function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  ) and (public.jwt_workspace() is null or public.jwt_workspace() = ws)
$$;

create function public.is_owner(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid() and m.role = 'owner'
  ) and public.jwt_workspace() is null   -- tokens de agente nunca agem como dono
$$;

-- Dois usuários compartilham algum workspace?
create function public.shares_workspace(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members a
    join public.workspace_members b on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid() and b.user_id = other
  )
$$;

revoke execute on function public.is_member(uuid), public.is_owner(uuid), public.shares_workspace(uuid) from public, anon;
grant execute on function public.is_member(uuid), public.is_owner(uuid), public.shares_workspace(uuid) to authenticated;

-- ───────────── triggers ─────────────

-- Perfil criado junto com o usuário de auth.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Quem cria o workspace vira dono.
create function public.handle_new_workspace() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role) values (new.id, new.created_by, 'owner');
  return new;
end $$;
create trigger on_workspace_created after insert on public.workspaces
  for each row execute function public.handle_new_workspace();

-- Número sequencial (#12) por workspace.
create function public.assign_task_number() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.workspaces set task_seq = task_seq + 1 where id = new.workspace_id
  returning task_seq into new.number;
  return new;
end $$;
create trigger before_task_insert before insert on public.tasks
  for each row execute function public.assign_task_number();

-- updated_at + regras de status: agente nunca marca "Concluído".
create function public.guard_task_update() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.number := old.number;
  new.workspace_id := old.workspace_id;
  if new.status = 'done' and old.status <> 'done' and public.jwt_workspace() is not null then
    raise exception 'agentes não podem concluir tarefas; use in_review' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger before_task_update before update on public.tasks
  for each row execute function public.guard_task_update();

-- ───────────── RLS ─────────────
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.repositories enable row level security;
alter table public.agent_connections enable row level security;
alter table public.tasks enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.task_links enable row level security;
alter table public.agent_sessions enable row level security;
alter table public.task_events enable row level security;
alter table public.context_entries enable row level security;
alter table public.technical_decisions enable row level security;
alter table public.git_snapshots enable row level security;

-- profiles
create policy "ver perfis de quem divide workspace" on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_workspace(id));
create policy "editar o próprio perfil" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- workspaces
create policy "membros veem o workspace" on public.workspaces for select to authenticated
  using (public.is_member(id) or (created_by = auth.uid() and public.jwt_workspace() is null));
create policy "humanos criam workspaces" on public.workspaces for insert to authenticated
  with check (created_by = auth.uid() and public.jwt_workspace() is null);
create policy "dono renomeia" on public.workspaces for update to authenticated
  using (public.is_owner(id)) with check (public.is_owner(id));

-- workspace_members (convites entram numa fase seguinte; por ora só o dono adiciona)
create policy "membros veem membros" on public.workspace_members for select to authenticated
  using (public.is_member(workspace_id));
create policy "dono adiciona membros" on public.workspace_members for insert to authenticated
  with check (public.is_owner(workspace_id));
create policy "dono remove membros" on public.workspace_members for delete to authenticated
  using (public.is_owner(workspace_id) and user_id <> auth.uid());

-- repositories
create policy "membros veem repositórios" on public.repositories for select to authenticated
  using (public.is_member(workspace_id));
create policy "dono gerencia repositórios" on public.repositories for all to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));

-- agent_connections: cada um vê e revoga só as próprias; criação via Edge Function (Fase 2)
create policy "ver as próprias conexões" on public.agent_connections for select to authenticated
  using (user_id = auth.uid() and public.is_member(workspace_id));
create policy "revogar as próprias conexões" on public.agent_connections for update to authenticated
  using (user_id = auth.uid() and public.jwt_workspace() is null)
  with check (user_id = auth.uid());

-- tasks
create policy "membros veem tarefas" on public.tasks for select to authenticated
  using (public.is_member(workspace_id));
create policy "membros criam tarefas" on public.tasks for insert to authenticated
  with check (public.is_member(workspace_id) and created_by = auth.uid());
create policy "membros editam tarefas" on public.tasks for update to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "dono apaga tarefas" on public.tasks for delete to authenticated
  using (public.is_owner(workspace_id));

-- task_dependencies / task_links
create policy "membros veem dependências" on public.task_dependencies for select to authenticated
  using (public.is_member(workspace_id));
create policy "membros gerenciam dependências" on public.task_dependencies for all to authenticated
  using (public.is_member(workspace_id))
  with check (public.is_member(workspace_id)
    and exists (select 1 from public.tasks t where t.id = task_id and t.workspace_id = task_dependencies.workspace_id)
    and exists (select 1 from public.tasks t where t.id = depends_on_task_id and t.workspace_id = task_dependencies.workspace_id));

create policy "membros veem vínculos" on public.task_links for select to authenticated
  using (public.is_member(workspace_id));
create policy "membros criam vínculos manuais" on public.task_links for insert to authenticated
  with check (public.is_member(workspace_id) and source in ('user', 'agent_declared')
    and exists (select 1 from public.tasks t where t.id = task_id and t.workspace_id = task_links.workspace_id));
create policy "membros removem vínculos" on public.task_links for delete to authenticated
  using (public.is_member(workspace_id));

-- agent_sessions: escrita só da própria sessão
create policy "membros veem sessões" on public.agent_sessions for select to authenticated
  using (public.is_member(workspace_id));
create policy "registrar a própria sessão" on public.agent_sessions for insert to authenticated
  with check (public.is_member(workspace_id) and user_id = auth.uid());
create policy "atualizar a própria sessão" on public.agent_sessions for update to authenticated
  using (public.is_member(workspace_id) and user_id = auth.uid())
  with check (user_id = auth.uid());

-- task_events: imutáveis; cliente não pode se passar por GitHub nem por hook
create policy "membros veem eventos" on public.task_events for select to authenticated
  using (public.is_member(workspace_id));
create policy "membros registram eventos próprios" on public.task_events for insert to authenticated
  with check (
    public.is_member(workspace_id)
    and user_id = auth.uid()
    and source in ('user', 'agent_declared', 'local_git')
    and (task_id is null or exists (select 1 from public.tasks t where t.id = task_id and t.workspace_id = task_events.workspace_id))
  );

-- context_entries
create policy "membros veem contexto" on public.context_entries for select to authenticated
  using (public.is_member(workspace_id));
create policy "humanos editam contexto" on public.context_entries for all to authenticated
  using (public.is_member(workspace_id) and public.jwt_workspace() is null)
  with check (public.is_member(workspace_id) and public.jwt_workspace() is null);

-- technical_decisions: qualquer membro propõe; só humano aprova
create policy "membros veem decisões" on public.technical_decisions for select to authenticated
  using (public.is_member(workspace_id));
create policy "membros propõem decisões" on public.technical_decisions for insert to authenticated
  with check (public.is_member(workspace_id) and status = 'proposed' and proposed_by = auth.uid());
create policy "humanos decidem" on public.technical_decisions for update to authenticated
  using (public.is_member(workspace_id) and public.jwt_workspace() is null)
  with check (public.is_member(workspace_id));

-- git_snapshots: cada um escreve só o próprio estado
create policy "membros veem git" on public.git_snapshots for select to authenticated
  using (public.is_member(workspace_id));
create policy "gravar o próprio git" on public.git_snapshots for insert to authenticated
  with check (public.is_member(workspace_id) and user_id = auth.uid()
    and exists (select 1 from public.repositories r where r.id = repository_id and r.workspace_id = git_snapshots.workspace_id));
create policy "atualizar o próprio git" on public.git_snapshots for update to authenticated
  using (user_id = auth.uid() and public.is_member(workspace_id))
  with check (user_id = auth.uid());

-- ───────────── Realtime ─────────────
alter publication supabase_realtime add table
  public.tasks, public.task_events, public.agent_sessions, public.git_snapshots,
  public.workspace_members, public.context_entries, public.task_links;
