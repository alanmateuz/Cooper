-- Excluir tarefas pelo widget, em qualquer status (inclusive concluídas e no backlog).
-- Antes só o dono do workspace apagava. Agora apaga o dono, quem criou a tarefa ou quem é o responsável.
-- Tokens de agente nunca apagam. Apagar deixa um evento com número e título na Atividade.
-- Coberto por tests/tasks.test.ts.

drop policy "dono apaga tarefas" on public.tasks;
create policy "dono, autor ou responsável apaga tarefas" on public.tasks for delete to authenticated
  using (
    public.is_member(workspace_id) and public.jwt_workspace() is null
    and (public.is_owner(workspace_id) or created_by = auth.uid() or assignee_id = auth.uid())
  );

create function public.log_task_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- apagar o workspace inteiro também apaga as tarefas: aí não há onde registrar
  if exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    insert into public.task_events (workspace_id, task_id, user_id, source, type, payload)
    values (old.workspace_id, null, public.current_actor(), 'user', 'task_deleted',
            jsonb_build_object('number', old.number, 'title', old.title));
  end if;
  return null;
end $$;
create trigger after_task_delete after delete on public.tasks
  for each row execute function public.log_task_delete();

revoke execute on function public.log_task_delete() from public, anon, authenticated;
