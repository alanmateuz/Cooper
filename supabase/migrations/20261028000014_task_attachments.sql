-- Cooper — anexos nas tarefas.
-- O arquivo fica no Supabase Storage (bucket privado task-files), não no banco: a tabela guarda só metadados.
-- Caminho no bucket: {workspace_id}/{task_id}/{id}-{nome}. Limites: 10 MB por arquivo, 20 anexos por tarefa.
-- Quem é membro vê e baixa; quem enviou, quem criou a tarefa ou o dono do projeto apaga.
-- A parte do Storage só roda onde o schema storage existe (Supabase); os testes locais cobrem a tabela.
-- Coberto por tests/sql/attachments.test.ts.

create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  path text not null unique check (char_length(path) <= 400),
  name text not null check (char_length(name) between 1 and 200),
  size_bytes bigint not null check (size_bytes between 0 and 10485760),
  mime text check (char_length(mime) <= 120),
  uploaded_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index on public.task_attachments (task_id, created_at);
alter table public.task_attachments enable row level security;

create function public.guard_task_attachment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = new.task_id;
  if not found or t.workspace_id <> new.workspace_id then
    raise exception 'tarefa não encontrada neste workspace' using errcode = 'P0002';
  end if;
  if new.path not like new.workspace_id::text || '/' || new.task_id::text || '/%' then
    raise exception 'caminho do anexo fora da pasta da tarefa' using errcode = '22023';
  end if;
  if (select count(*) from public.task_attachments where task_id = new.task_id) >= 20 then
    raise exception 'limite de 20 anexos por tarefa' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger before_task_attachment_insert before insert on public.task_attachments
  for each row execute function public.guard_task_attachment();
revoke execute on function public.guard_task_attachment() from public, anon, authenticated;

create policy "membros veem anexos" on public.task_attachments for select to authenticated
  using (public.is_member(workspace_id));
create policy "membros anexam" on public.task_attachments for insert to authenticated
  with check (public.is_member(workspace_id) and uploaded_by = auth.uid() and public.jwt_workspace() is null);
create policy "quem enviou, quem criou a tarefa ou o dono apaga" on public.task_attachments for delete to authenticated
  using (public.is_member(workspace_id) and (
    uploaded_by = auth.uid()
    or exists (select 1 from public.tasks t where t.id = task_id and t.created_by = auth.uid())
    or public.is_owner(workspace_id)));

-- Evento na tarefa (aparece na Atividade e no painel da tarefa).
create function public.log_task_attachment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (workspace_id, task_id, user_id, source, type, payload)
    values (new.workspace_id, new.task_id, new.uploaded_by, 'user', 'attachment_added', jsonb_build_object('name', new.name));
  else
    insert into public.task_events (workspace_id, task_id, user_id, source, type, payload)
    values (old.workspace_id, old.task_id, auth.uid(), 'user', 'attachment_removed', jsonb_build_object('name', old.name));
  end if;
  return null;
end $$;
create trigger after_task_attachment after insert or delete on public.task_attachments
  for each row execute function public.log_task_attachment();
revoke execute on function public.log_task_attachment() from public, anon, authenticated;

alter publication supabase_realtime add table public.task_attachments;

-- ───────────── Storage (só no Supabase) ─────────────
do $do$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit)
  values ('task-files', 'task-files', false, 10485760)
  on conflict (id) do update set public = false, file_size_limit = 10485760;

  -- pasta raiz = workspace: só membros leem e enviam; apagar segue a mesma regra da tabela
  execute $p$
    create policy "cooper: membros leem anexos" on storage.objects for select to authenticated
      using (bucket_id = 'task-files' and public.is_member(((storage.foldername(name))[1])::uuid))
  $p$;
  execute $p$
    create policy "cooper: membros enviam anexos" on storage.objects for insert to authenticated
      with check (bucket_id = 'task-files' and public.is_member(((storage.foldername(name))[1])::uuid))
  $p$;
  execute $p$
    create policy "cooper: apagar anexos" on storage.objects for delete to authenticated
      using (bucket_id = 'task-files' and exists (
        select 1 from public.task_attachments a
        where a.path = storage.objects.name and public.is_member(a.workspace_id) and (
          a.uploaded_by = auth.uid()
          or exists (select 1 from public.tasks t where t.id = a.task_id and t.created_by = auth.uid())
          or public.is_owner(a.workspace_id))))
  $p$;
end $do$;

create or replace function public.cooper_server_info() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('app', 'cooper', 'schema', 14)
$$;
