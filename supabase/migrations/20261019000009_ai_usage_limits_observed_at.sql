-- Horário em que os limites foram lidos (status line, botão "Atualizar limite" ou Codex),
-- para o cartão mostrar "lido HH:MM" e esmaecer leituras antigas.
alter table public.ai_usage add column limits_observed_at timestamptz;
