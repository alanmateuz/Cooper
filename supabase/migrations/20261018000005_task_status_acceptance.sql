-- Cooper — nova direção, etapa 2: estados de aceite da tarefa.
-- Fica numa migração separada porque um valor novo de enum só pode ser usado
-- depois que a transação que o criou termina.
--
--   aguardando aceite → backlog (aceita) → em andamento → concluída
--           └→ recusada (com motivo)

alter type public.task_status add value if not exists 'awaiting_acceptance' before 'backlog';
alter type public.task_status add value if not exists 'declined' after 'done';
