# Cooper — Relatório da Fase 2 (servidor MCP)

Data: 2026-10-18.

## Feito

- **Tokens por agente**: `coop_` + 48 caracteres hexadecimais. Só o hash sha256 vai para o banco (`agent_connections`). O token aparece uma vez, no widget, em Configurações → Agentes, onde também dá para listar e revogar.
- **Autorização dos agentes no Postgres**: cada ferramenta chama uma RPC `SECURITY DEFINER` que valida o token, confere se o dono ainda é membro e restringe tudo ao workspace da conexão. Há limite de 120 chamadas por minuto por conexão.
  - Muda o que o relatório da Fase 0 propunha (Edge Function que trocava o token por um JWT). Não precisa de deploy nem de guardar o segredo JWT.
  - Custo: humanos são autorizados pelo RLS e agentes pelas funções. Os testes cobrem os dois caminhos.
- **`packages/mcp-server`** (stdio, `@modelcontextprotocol/sdk`): `get_workspace_context`, `get_my_tasks`, `get_task_context`, `start_task`, `report_progress`, `get_team_status`.
  - Uma sessão por processo; ao sair, ela é encerrada (melhor esforço).
  - Tudo o que o agente registra recebe a origem `agent_declared`.
- **`pnpm mcp:config <claude-code|codex> [--write]`**: mostra o que vai gravar e só aplica com `--write`. Grava no escopo do usuário, nunca dentro dos repositórios.

## Verificado

| Item | Como | Resultado |
|---|---|---|
| Segurança das RPCs: token inválido ou revogado, outro workspace, payload malformado, funções internas não expostas | `pnpm test:db` | 7/7 |
| Ponta a ponta com dois clientes MCP via stdio, inclusive a entrega pelo Realtime | `pnpm test:db` | 4/4 |
| RLS da Fase 1 continua valendo | `pnpm test:db` | 11/11 |
| **Critério 3**: um cliente consulta suas tarefas | Codex real (Alan teste) | ok |
| **Critério 4**: o segundo cliente recupera o estado do time | Claude Code real (Bia teste) viu "Revisando validação do QR" | ok |
| **Critério 5**: o progresso chega ao widget e ao outro cliente | cartão do Alan atualizou sozinho, com selo `declarado` | ok |

## Configuração alterada no seu usuário (com autorização)

- `~/.codex/config.toml`: entrada `[mcp_servers.cooper]` com o token do Alan (teste). O Codex reescreveu a ordem de outras chaves ao salvar; o conteúdo é equivalente.
- `~/.claude.json`: `mcpServers.cooper` com o token da Bia (teste).
- Backups: `*.bak-cooper-20261018-155818`.

## Pendências

- **Migração `20261018000003_team_status_revoked.sql` não aplicada.** O `SUPABASE_DB_URL` atual é recusado pelo banco (senha). Ela esconde sessões de tokens revogados e as encerra ao revogar. Basta `pnpm db:push` quando a URL estiver correta. Sem ela, uma sessão de token revogado aparece por até 2 horas em `get_team_status`.
- Os tokens configurados nos clientes são de **usuários de teste**. Para o uso real: gerar um token da sua conta no widget, rodar `pnpm mcp:config … --write` e revogar os de teste.
- Os tokens ficam em texto puro na configuração dos clientes; o chaveiro do sistema operacional fica para depois.
- As sessões do seed ("hook" de exemplo) ainda misturam o status no widget, por exemplo "Inativo" quando o certo seria "Desconhecido". Somem quando o seed for limpo ou quando vierem hooks reais (Fase 4).
- A sessão MCP usa um id próprio por processo, não o `session_id` do cliente. Na Fase 4 é preciso unir as duas coisas.

## Próximo passo: Fase 3 (git local e GitHub)

Observador de git no app desktop (branch, HEAD, à frente/atrás, arquivos não commitados) gravando `git_snapshots` de verdade; GitHub API e webhooks num repositório de testes; vínculo tarefa ↔ branch, commit e PR.
