# Cooper

Painel flutuante, sempre visível, que mostra quem do time está trabalhando, com qual agente de IA, em quê e com qual contexto.

Especificação: `COOPER_INSTRUCOES.md` (fora do repo). Análise e decisões: [docs/FASE0_RELATORIO.md](docs/FASE0_RELATORIO.md).

## Estrutura

```
apps/desktop        widget (Tauri v2 + React + Tailwind)
packages/shared     enums, esquemas Zod, regra de presença (com testes)
supabase/migrations esquema, RLS, Realtime
scripts/            db-push e seed
tests/              testes de RLS contra o projeto Supabase
```

## Configuração

Pré-requisitos: Node 24, pnpm, Rust (MSVC) + Visual Studio Build Tools (C++), WebView2.

```bash
pnpm install
cp .env.example .env   # preencha SUPABASE_SERVICE_ROLE_KEY e SUPABASE_DB_URL
pnpm db:push           # aplica as migrações no projeto hospedado
pnpm db:seed           # cria 3 usuários de teste; senhas vão para .env.local
```

## Rodar

```bash
pnpm dev:web       # só a interface, no navegador (http://localhost:1420)
pnpm dev:desktop   # app Tauri (janela flutuante, bandeja, atalho Ctrl+Shift+Espaço)
```

Entre com `alan.teste@example.com` ou `bia.teste@example.com` e a senha em `.env.local`.

## Testes

```bash
pnpm test        # unitários (presença, validação)
pnpm test:db     # RLS, RPCs de agente e MCP ponta a ponta, contra o Supabase (precisa de db:push, db:seed, mcp:build)
```

## Origem dos dados

Todo dado no widget mostra de onde veio: `usuário`, `declarado` (agente via MCP), `hook` (evento observado do cliente),
`git local`, `GitHub`, `testes`. "Executando" só aparece com evento de hook recente.

## Conectar um agente (MCP)

1. No widget: Configurações → Agentes → escolha o agente → **Gerar token** (aparece uma vez).
2. Na raiz deste repositório, no PowerShell, rode o comando copiado do widget. Sem `--write`, ele só mostra o que vai gravar:
   ```
   $env:COOPER_TOKEN="coop_..."; pnpm mcp:config codex          # ou claude-code
   $env:COOPER_TOKEN="coop_..."; pnpm mcp:config codex --write  # aplica (escopo de usuário)
   ```
A configuração fica no nível do usuário (`~/.codex/config.toml` / `~/.claude.json`): nada é escrito dentro dos repositórios em que você trabalha.
