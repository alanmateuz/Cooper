# Cooper — Relatório da Fase 1 (fundação)

Data: 2026-10-18.

## Feito

- Monorepo pnpm: `apps/desktop`, `packages/shared`, `supabase/`, `scripts/`, `tests/`.
- **Supabase hospedado**: migração `20261018000001_init.sql` aplicada. 13 tabelas, RLS por workspace e Realtime.
  - Fonte de evento `agent_hook` adicionada às da especificação, para separar o que é observado (hook) do que é declarado (MCP).
  - Acrescentadas `task_dependencies`, `task_links` e `agent_sessions` (ver relatório da Fase 0).
  - As funções `is_member` e `is_owner` já respeitam a claim `cooper_ws`, que os tokens de agente da Fase 2 vão usar. Um trigger impede agente de marcar tarefa como "Concluído".
- **Seed**: Alan e Bia no workspace "Hacko (demo)"; Intruso num workspace isolado. As senhas ficam em `.env.local`, fora do git.
- **Widget** (Tauri v2 + React + Tailwind):
  - modos pílula (220×44), compacto e expandido (360×520);
  - cartões com status de presença e selo de origem em cada informação;
  - abas Agora, Tarefas (criação rápida e painel de detalhes), Contexto, Atividade e Configurações;
  - tema escuro/claro e opção de esmaecer quando fora do foco;
  - casca nativa: janela sem moldura, sempre no topo e arrastável; bandeja (mostrar/ocultar, pausar sincronização, sair); atalho Ctrl+Shift+Espaço; posição lembrada entre execuções.

## Verificado

| Item | Como | Resultado |
|---|---|---|
| Regra de presença e validação | `pnpm test` | 12/12 |
| Isolamento entre workspaces (critério 10) | `pnpm test:rls`, contra o projeto real | 11/11 |
| Tarefa criada por um usuário aparece no widget do outro sem recarregar (critério 2) | script como Bia, widget logado como Alan | ok |
| Dois usuários veem o mesmo workspace (critério 1) | teste de RLS e widget | ok |
| Dados persistem (critério 7, parte do banco) | dados continuam após reiniciar o app | ok |
| Três modos sem passar de 360×520 (critério 11) | navegador e app Tauri | ok |
| Janela nativa, arraste, pílula, atalho, bandeja, posição | app Tauri, conferido pelo usuário | ok |

## Limitações

- A sessão de login fica no localStorage do webview; o chaveiro do SO entra na Fase 2. Por isso o app Tauri e o navegador têm logins separados.
- Sessões e eventos de agente no seed são **dados de exemplo**. Os reais vêm na Fase 2 (MCP) e na Fase 4 (hooks).
- O atalho global é fixo (Ctrl+Shift+Espaço), ainda não configurável.
- Ainda não existem pela interface: convites, cadastro de repositório e conexão de agentes.
- Alertas de conflito ficam para a Fase 4.

## Notas de ambiente

- A senha do banco tem `#`, `@` e `&`. Por isso `scripts/db-push.mjs` lê a linha crua do `.env` e chama o binário do Supabase sem shell.
- No Windows, parar o `pnpm dev` não encerra o processo do Vite. Se a porta 1420 ficar ocupada, encerre o `node vite.js` que estiver nela.

## Próximo passo: Fase 2 (servidor MCP)

- Edge Function `agent-token`: troca o token pessoal (guardado com hash) por um JWT curto com `cooper_ws`, para que o RLS valha também para agentes.
- `packages/mcp-server` (stdio) com as seis ferramentas prioritárias.
- Configuração no Claude Code e no Codex, mostrada antes de escrever, e teste de ponta a ponta entre os dois clientes (critérios 3, 4 e 5).
