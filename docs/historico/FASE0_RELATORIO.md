# Cooper — Relatório da Fase 0 (análise)

Data: 2026-10-18. Nenhum código de produto foi escrito. O Hacko foi só lido (lista de branches via `git ls-remote` e a página pública do GitHub), sem clonar e sem alterar nada.

Legenda de confiança: **[doc]** confirmado na documentação oficial atual · **[testado]** executado nesta máquina · **[não verificado]** suposição que ainda precisa de teste.

---

## 1. Ambiente desta máquina [testado]

| Ferramenta | Situação | Impacto |
|---|---|---|
| Node 24.16 / npm 11.13 / git 2.54 | ok | — |
| pnpm | ausente | resolve com `corepack enable` |
| Rust / cargo (+ MSVC Build Tools, WebView2) | ausente | **bloqueia o Tauri** (Fase 1) |
| Docker | ausente | **bloqueia o Supabase local** (o CLI sobe tudo em contêineres) |
| Supabase CLI | ausente | instalar via npm (`npx supabase`) ou scoop |
| `claude` CLI no PATH | ausente neste shell | hooks do Claude Code verificados só na doc, não testados |
| `codex` CLI | ausente | **nada do Codex pôde ser testado** |
| `gh` | ausente | não é obrigatório (Octokit cobre) |

Instalar isso é alteração de sistema: deixo para você fazer ou autorizar.

---

## 2. Integração com os agentes — o que existe de fato

### Claude Code [doc]
- **Hooks** configuráveis em `~/.claude/settings.json` (usuário), `.claude/settings.json` (projeto, versionado) e `.claude/settings.local.json` (projeto, ignorado pelo git). Entradas se somam entre níveis.
- Eventos úteis para o Cooper: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `Notification` (ex.: `permission_prompt`, `idle_prompt`), `SubagentStart/Stop`, `CwdChanged`. Há muitos outros.
- Campos comuns (stdin em JSON): `session_id`, `cwd`, `transcript_path`, `hook_event_name`, `permission_mode`, `agent_id/agent_type`. Ferramentas: `tool_name`, `tool_input`, `tool_use_id`; `PostToolUse` traz também `tool_response` e `duration_ms`.
- Tipos de handler: `command`, `http`, `mcp_tool`, `prompt`, `agent`. **Só `command` aceita `async: true`** (roda em segundo plano sem atrasar o agente).
- **MCP**: servidor stdio por projeto via `.mcp.json` ou por usuário via `claude mcp add --scope user`. Variáveis com `${VAR}`. Servidores de `.mcp.json` pedem aprovação na sessão interativa.

### Codex [doc, não testado]
- **Hooks existem** e vêm ligados por padrão (`[features] hooks = false` desliga). Eventos: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`, `Interrupt`, `Pre/PostCompact`, `SubagentStart/Stop`. Campos parecidos com os do Claude Code, mais um `turn_id`.
- Configuração em `~/.codex/hooks.json` / `~/.codex/config.toml` ou `<repo>/.codex/...` (este só carrega se o projeto for marcado como confiável).
- Handlers: só `command` e `mcp_tool` (`prompt`/`agent` são lidos mas ignorados). Existe override `commandWindows`; **suporte real no Windows não foi confirmado**.
- O antigo `notify` (só `agent-turn-complete`) continua existindo, mas os hooks o substituem.
- **MCP**: `[mcp_servers.<nome>]` no `config.toml` com `command`, `args`, `env`, `env_vars`; transportes stdio e Streamable HTTP; `codex mcp add nome -- cmd`.

### Consequências para o design
1. **Um único CLI (`cooper-hook`, Node) atende aos dois agentes**: os dois mandam JSON no stdin com formato parecido. Usar `command` + `async: true` no Claude Code. Não usar o handler `http`: o Codex não tem, e não confirmei como passar o token nos headers.
2. **Privacidade é obrigatória no próprio hook.** `UserPromptSubmit` traz o **prompt inteiro**, `PostToolUse` traz a **saída da ferramenta** (que pode conter código) e `Stop` traz a última mensagem do agente. O CLI precisa de **lista branca**: envia só evento, nome da ferramenta, caminhos de arquivo (se permitido), duração e horário. Prompt, resposta e transcrição nunca saem da máquina.
3. **Não escrever nada no repositório do Hacko.** Configurar hooks/MCP **no nível do usuário** e fazer o `cooper-hook` filtrar pelo `cwd` (só reporta se o `cwd` estiver dentro de um repositório cadastrado). Assim não aparecem arquivos novos no checkout do Hacko. A alternativa por projeto (`.claude/settings.local.json`, `.codex/`) criaria arquivos não rastreados lá.
4. MCP continua sendo **declaração**: o agente só reporta se chamar a ferramenta. Hooks são **observação** (o cliente disparou o evento), mas não dizem *em que tarefa* o agente está: isso vem do `start_task` ou do nome da branch.

---

## 3. Arquitetura — ajustes propostos

```
Cooper Desktop (Tauri+React) ──realtime──► Supabase (Postgres+Auth+Realtime+RLS)
  └ observador git local ─────upsert──────►   ▲
cooper-mcp (stdio, 1 processo por sessão) ────┤ (JWT curto do agente → RLS)
cooper-hook (CLI, async) ──HTTPS──► Edge Function `agent-events`
GitHub webhooks ──────────────────► Edge Function `github-webhook`
```

1. **Sem `apps/api` no MVP**: usar Supabase Edge Functions (`agent-events`, `github-webhook`, `agent-token`). Um serviço a menos para rodar.
2. **Hooks não falam com o `cooper-mcp`**, ao contrário do diagrama original. O servidor stdio é iniciado pelo cliente a cada sessão, pode não estar vivo e não tem porta fixa. Os hooks mandam direto para a Edge Function.
3. **RLS como único ponto de autorização, também para agentes**: o token pessoal (guardado com hash) é trocado em `agent-token` por um JWT curto com `workspace_id`/`member_id`. O `cooper-mcp` usa esse JWT com `supabase-js`, e as políticas RLS valem igual para humanos e agentes. **[não verificado]**: confirmar como emitir JWT customizado com o esquema atual de chaves de assinatura do Supabase. Plano B: toda escrita do agente passa por Edge Function com checagem explícita de workspace, coberta pelo teste do critério 10.
4. **GitHub no MVP**: PAT *fine-grained* somente leitura, restrito ao repositório de testes (Metadata, Contents, Pull requests, Checks/Actions: read), mais um webhook configurado à mão com segredo. GitHub App fica para quando houver vários usuários.
5. **Webhooks precisam de URL pública.** Com o Supabase local é preciso um túnel (smee.io ou cloudflared). Com um projeto Supabase hospedado gratuito não precisa. Ver decisões abaixo.

Modelo de dados — acréscimos: `task_dependencies` (exigida pela regra de conflito 3), `task_links` (tarefa ↔ branch/commit/PR) e `agent_sessions` no lugar do genérico `sessions` (session_id do cliente, agente, membro, `last_event_at`, `ended_at`).

---

## 4. Riscos e ambiguidades

| # | Ponto | Proposta |
|---|---|---|
| 1 | "Executando nos últimos N minutos" sem N | **Executando**: Pre/PostToolUse ou UserPromptSubmit há ≤ 2 min e sem `Stop` depois. **Online**: `SessionStart` sem `SessionEnd` e evento há ≤ 30 min. **Inativo**: além disso. **Desconhecido**: membro sem hooks configurados (só MCP/git). Valores configuráveis. |
| 2 | `SessionEnd` pode não disparar (crash, terminal fechado) | expirar por tempo; nunca confiar só no fim de sessão |
| 3 | Uma pessoa com Claude Code e Codex ao mesmo tempo | um cartão por pessoa, com uma linha por sessão de agente ativa |
| 4 | Git local só existe para quem roda o app desktop | os dois devs precisam do app; quem não tiver aparece com selo só `GitHub` |
| 5 | "Branch muito atrás" sem limite definido | padrão: > 20 commits atrás ou base com mais de 3 dias; configurável |
| 6 | Janela transparente, sem moldura e com cantos arredondados no Windows | **[não verificado]** no WebView2; testar no início da Fase 1. Plano B: cantos retos |
| 7 | Chaveiro do SO | não há plugin oficial do Tauri que use o keychain/Credential Manager. Usar o crate `keyring` via comando Rust. O `cooper-hook` (Node) também precisa do token: usar o mesmo chaveiro ou um arquivo com permissão restrita **[decidir]** |
| 8 | Fase 6, "tokens" | hooks não informam consumo de tokens; só dá para medir lendo a transcrição local, o que conflita com "não armazenar conversas". Medir localmente sem enviar |
| 9 | Nomes de arquivos são metadado sensível | interruptor por workspace/membro desde a Fase 3 (já previsto na §9) |
| 10 | Codex no Windows | não testado; pode exigir WSL. Validar antes de prometer o critério 4 com Codex |

---

## 5. Reutilização

- `@modelcontextprotocol/sdk` (servidor stdio), `zod`
- `@supabase/supabase-js`, Supabase CLI (migrações, seed, testes de RLS com `pgTAP` via `supabase test db`)
- `@octokit/rest` + `@octokit/webhooks` (verificação de assinatura)
- Tauri v2: config de janela (`alwaysOnTop`, `decorations: false`, `transparent`), tray (`tray-icon` no core), `plugin-global-shortcut`, `plugin-window-state` (posição e tamanho), `plugin-store` (preferências); crates `keyring` e `notify` (watcher de `.git/HEAD` e `.git/index`). Para o git, chamar o próprio `git` (`status --porcelain=v2 --branch`) em vez de `git2`: menos código e o mesmo resultado.

---

## 6. Decisões que preciso de você

1. **Pré-requisitos**: instalar Rust + MSVC Build Tools, Docker Desktop, Codex CLI e Supabase CLI (eu não instalo software de sistema sem autorização).
2. **Supabase local (Docker) ou projeto hospedado gratuito** para o desenvolvimento? O hospedado evita o Docker e o túnel de webhook, mas é um recurso externo criado na sua conta.
3. **Onde fica o repositório do Cooper** (pasta local e, depois, repositório no GitHub).
4. Confirmar que **configurar hooks e MCP no nível do usuário, com filtro por `cwd`**, é aceitável para usar com o Hacko sem tocar no repositório dele.
