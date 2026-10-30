-- Atualização do esquema 17 para 18 (revisão humana). Para quem já rodou o 16-para-17. Cole no SQL Editor e rode uma vez.

-- Revisão humana por projeto: com require_human_review ligado, um agente nunca conclui uma tarefa.
-- O complete_task do agente leva a tarefa para "Em revisão", e só uma pessoa a marca como concluída.
-- Isso vale no Cooper. No GitHub, quem bloqueia o merge sem aprovação é a proteção de branch do próprio GitHub.

alter table public.workspaces add column require_human_review boolean not null default false;

-- Depois do guard_task_update (ordem alfabética dos triggers): o agente pediu "done", vira "in_review".
create function public.human_review_gate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'done' and old.status is distinct from 'done'
     and auth.uid() is null and nullif(current_setting('cooper.actor', true), '') is not null
     and (select w.require_human_review from public.workspaces w where w.id = new.workspace_id) then
    new.status := 'in_review';
  end if;
  return new;
end $$;
revoke execute on function public.human_review_gate() from public, anon, authenticated;

create trigger human_review_gate before update of status on public.tasks
  for each row execute function public.human_review_gate();

create or replace function public.cooper_server_info() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('app', 'cooper', 'schema', 18)
$$;
