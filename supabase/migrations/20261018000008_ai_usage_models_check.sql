-- Corrige a regra de ai_usage.models da migração 7: o Postgres limita repetições de regex a 255,
-- então `{0,900}` invalidava a expressão e toda gravação era recusada. O tamanho vira uma regra à parte.

alter table public.ai_usage drop constraint ai_usage_models_check;
alter table public.ai_usage add constraint ai_usage_models_check check (
  cardinality(models) <= 10
  and char_length(array_to_string(models, ',')) <= 900
  and array_to_string(models, ',') ~ '^[A-Za-z0-9._:,-]*$'
);
