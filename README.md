# Cooper

Um painel pequeno, sempre visível no canto da tela, para times que programam com agentes de IA (Claude Code e Codex).
Ele mostra **quem está trabalhando, com qual agente, em qual tarefa e com qual contexto**, e deixa os agentes de cada
pessoa lerem as mesmas tarefas e o mesmo contexto do projeto.

O Cooper não programa e não substitui os agentes. Também não é um Jira: só sincroniza o trabalho do time.

> Capturas de tela: em breve.

## O que ele faz

- **Agora**: um cartão por pessoa, com presença, agente, tarefa atual, última frase de progresso e uso de IA do dia.
- **Tarefas**: criar, enviar para alguém (que aceita ou recusa com motivo), editar, mudar de status. Cada tarefa pode ter
  um **prompt**, o que a IA de quem recebe deve fazer. Mudar o prompt de uma tarefa já aceita pede novo aceite.
- **Contexto**: blocos de texto compartilhados (Resumo, Arquitetura, Convenções…), com versão, histórico e "desfazer".
- **Atividade**: linha do tempo do time, com a origem de cada informação (`declarado`, `hook`, `git local`, `usuário`).
- **Agentes por MCP**: o Claude Code e o Codex de cada pessoa recebem ferramentas do Cooper (`get_briefing`,
  `get_task_context`, `start_task`, `report_progress`, `complete_task`, edição de contexto…). As respostas vêm
  compactas para gastar pouco contexto.
- Pílula recolhida, atalho **Ctrl+Shift+Espaço**, ícone na bandeja, notificações com som.

## Instalar (Windows)

1. Baixe o instalador `Cooper_x.y.z_x64-setup.exe` em [Releases](../../releases).
2. Abra o Cooper. Na primeira tela:
   - **Tenho um código de conexão**, se alguém do time te convidou e mandou o código; ou
   - **Criar meu servidor**, se você está começando o time. O guia está em [docs/SETUP_SUPABASE.md](docs/SETUP_SUPABASE.md).
3. Crie sua conta e entre no projeto (ou crie um).

O instalador não tem assinatura digital. Se o Windows avisar "aplicativo não reconhecido", clique em
**Mais informações → Executar assim mesmo**.

## Conectar o seu agente

1. No Cooper: ⚙ **Ajustes → Agentes**, escolha **Claude Code** ou **Codex** → **Gerar token**.
2. Clique em **Conectar ao Claude Code** (ou Codex). O Cooper grava a entrada `cooper` na configuração de usuário do agente
   (`~/.claude.json` ou `~/.codex/config.toml`), com backup. Nada é escrito dentro dos seus repositórios.
3. Abra uma conversa nova no agente e peça: *"use o cooper: o que tenho para fazer?"*

Requisito: **Node.js 20+** (o servidor MCP roda com `node`). Os tokens ficam guardados só como hash no servidor e podem
ser revogados a qualquer momento.

## Privacidade

- O Cooper **não lê nem guarda** conversas com os agentes nem código.
- Os agentes enviam só frases curtas de progresso (até 120 caracteres), resumos de conclusão e, se quiserem, nomes de arquivos.
- O uso de IA (tokens, modelo, percentual de limite) é lido localmente e **só é compartilhado se você ligar** em ⚙ → Uso de IA.
  Desligar apaga o que foi enviado.
- Cada time usa o próprio servidor Supabase; cada projeto é isolado por RLS (testado).

## Segurança do servidor

- **Deixe "Confirm email" ligado** no Supabase. O convite para um projeto confia no e-mail que vem no JWT da conta;
  sem confirmação, alguém poderia criar conta com o e-mail de outra pessoa e aceitar o convite dela.
- Agentes só acessam o banco pelas funções `mcp_*`, autenticadas pelo token.
- Só quem criou a tarefa (ou o dono do projeto) edita título, prompt, descrição e critérios.

## Desenvolvimento

Pré-requisitos: Node 24, pnpm, Rust (MSVC) e Visual Studio Build Tools com C++ (para o app), WebView2.

```bash
pnpm install
pnpm dev:web       # só a interface, no navegador (http://localhost:1420)
pnpm dev:desktop   # app Tauri
pnpm tauri build   # instalador (em apps/desktop)
```

Em `pnpm dev`, se o `.env` da raiz tiver `SUPABASE_URL` e `SUPABASE_ANON_KEY`, o app pula a tela de Setup.
O instalador nunca leva essas constantes: cada pessoa escolhe o servidor.

```
apps/desktop          app (Tauri v2 + React 19 + Tailwind 4)
packages/mcp-server   servidor MCP (stdio) usado pelos agentes
packages/shared       tipos, esquemas Zod, regras de presença e uso, regras dos agentes
supabase/migrations   esquema, RLS, RPCs; supabase/install.sql é tudo junto
scripts/              install.sql, db-push, seed
tests/sql             testes de SQL num Postgres local (PGlite), sem servidor
tests/*.test.ts       testes de ponta a ponta contra um Supabase de testes
```

### Testes

```bash
pnpm typecheck
pnpm mcp:build && pnpm test        # unitários + SQL (PGlite, offline)
cd apps/desktop/src-tauri && cargo test
pnpm test:db                       # ponta a ponta: precisa de um Supabase de TESTES (.env), db:push e db:seed
```

### Banco

```bash
pnpm db:install-sql   # regenera supabase/install.sql a partir das migrações
pnpm db:push          # aplica as migrações no Supabase do .env (SUPABASE_DB_URL)
pnpm db:seed          # usuários e dados de exemplo (senhas em .env.local)
```

Documentos: [o que é o Cooper](docs/O_QUE_E_O_COOPER.md) · [contexto para agentes](docs/CONTEXTO_COOPER.md) ·
[criar o servidor](docs/SETUP_SUPABASE.md) · [histórico das fases](docs/historico/).

## Licença

A definir.
