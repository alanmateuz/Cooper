<p align="center">
  <img src="docs/assets/banner.svg" alt="Cooper — coordenação em tempo real para times que programam com IA" width="100%">
</p>

<p align="center">
  <a href="../../releases"><img alt="Versão" src="https://img.shields.io/badge/vers%C3%A3o-0.8.1-8b5cf6"></a>
  <a href="https://github.com/alanmateuz/Cooper/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/alanmateuz/Cooper/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="MCP" src="https://img.shields.io/badge/MCP-Claude%20Code%20%7C%20Codex-c77bf9">
  <img alt="Stack" src="https://img.shields.io/badge/Tauri%202%20%C2%B7%20React%2019%20%C2%B7%20Supabase-1a1b20">
  <a href="LICENSE"><img alt="Licença MIT" src="https://img.shields.io/badge/licen%C3%A7a-MIT-lightgrey"></a>
  <a href="#feito-com-agentes-de-ia"><img alt="Feito com agentes de IA" src="https://img.shields.io/badge/feito%20com-agentes%20de%20IA-8b5cf6"></a>
</p>

O Cooper coordena o trabalho de times que programam com agentes de IA (Claude Code e Codex). As pessoas acompanham o
time num painel de mesa sempre visível, e os agentes de cada uma se conectam ao Cooper por MCP: leem as mesmas tarefas e o
mesmo contexto do projeto, informam o que estão fazendo e consultam o que os agentes dos colegas estão fazendo.

> **Feito com agentes de IA.** O código do Cooper foi escrito com o Claude Code, sob a direção de Alan Mateus Queiroz.
> Detalhes em [Feito com agentes de IA](#feito-com-agentes-de-ia).

<p align="center">
  <img src="docs/assets/screenshot-agora.png" alt="Aba Agora: um cartão por pessoa com tarefa, agente e limites de IA" width="560">
</p>

---

## Motivação

O projeto começou do uso em dupla, com cada pessoa trabalhando com o próprio agente no mesmo repositório. Alguns
problemas apareceram com frequência:

- Os agentes não têm informação uns sobre os outros. O Claude Code de uma pessoa e o Codex da outra podem alterar o mesmo
  módulo ao mesmo tempo.
- Cada conversa começa sem memória do projeto. Decisões de arquitetura e convenções precisam ser explicadas de novo a cada sessão.
- O GitHub mostra apenas o que já foi enviado, e não o que está em andamento em cada máquina.
- Ferramentas de gestão de tarefas não entregam o trabalho num formato que o agente de outra pessoa consiga executar, nem
  recebem o progresso de volta.

## O que o Cooper faz

| Para as pessoas | Para os agentes (via MCP) |
|---|---|
| Painel com quem está online, com qual agente, em qual tarefa e o último progresso | `get_briefing` traz, numa chamada, as tarefas pendentes, as próprias e o que cada colega está fazendo |
| Tarefas com prompt, ou seja, o que a IA de quem recebe deve fazer. Quem recebe aceita ou recusa com motivo (ou liga o aceite automático) | `get_task_context`, `start_task`, `report_progress` e `complete_task` com evidências |
| Subtarefas, comentários, anexos, prioridade e prazo | `create_subtask`, `add_task_comment`, `get_task_discussion`, `plan_task` |
| Contexto do projeto em blocos versionados (Resumo, Arquitetura, Convenções…) | Leitura apenas dos blocos necessários, edição de trechos com `patch_context_block` e resumo com `summarize_context` |
| **Skills do time**: um bloco `Skill: nome` vira um passo a passo que qualquer IA do time segue | No Claude Code, o comando `/mcp__cooper__nome` |
| Modo coordenador (opcional, por pessoa): a IA vê a carga e o limite de cada um e redistribui o trabalho | `get_team_workload`, `assign_task`, `update_task` |
| **Coordenação entre agentes**: dependências entre tarefas, aviso quando a dependência termina, bloqueios, disponibilidade e limite de tarefas abertas por pessoa | `create_task` com `depends_on`, `set_dependencies`, `set_blocked`, `set_availability`, `handoff_task`; o `get_briefing` traz as novidades desde o último (`since_last`) |
| **Só pessoas aprovam PRs** (opcional, por projeto) | O hook barra `gh pr merge` e `gh pr review --approve`; tarefas param em *Em revisão* |
| Linha do tempo com a origem de cada informação | Tudo o que o agente registra aparece como `declarado` |

O Cooper não programa e não substitui os agentes. Ele cuida da coordenação entre eles e entre as pessoas.

## Vantagens para quem trabalha com IA

- **Menos conflito entre agentes.** Antes de editar arquivos, o agente consulta o que o time está fazendo e avisa se houver sobreposição.
- **Menos contexto repetido.** O agente lê os blocos de contexto do time no início da conversa e registra o que aprendeu,
  em vez de depender de explicações refeitas a cada sessão.
- **Delegação entre pessoas.** Uma tarefa pode ser enviada já com o prompt pronto para o agente de outra pessoa executar.
- **Acompanhamento automático.** O progresso é informado pelo próprio agente e aparece no painel em tempo real, sem
  atualização manual de quadros.
- **Baixo custo de tokens.** O briefing vem numa única chamada e as respostas são compactadas.
- **Visibilidade do uso.** Opcionalmente, o painel mostra tokens do dia e o percentual de limite do Claude Code e do Codex de cada pessoa.

## Como funciona

```mermaid
flowchart LR
  subgraph A["Máquina da Ana"]
    WA["Painel Cooper"]
    CA["Claude Code"] -- MCP --> MA["servidor MCP<br/>do Cooper"]
  end
  subgraph B["Máquina do Bruno"]
    WB["Painel Cooper"]
    CB["Codex"] -- MCP --> MB["servidor MCP<br/>do Cooper"]
  end
  DB[("Supabase do time<br/>Postgres + RLS + Realtime")]
  MA -- "RPC mcp_* + token" --> DB
  MB -- "RPC mcp_* + token" --> DB
  WA <-- "tempo real" --> DB
  WB <-- "tempo real" --> DB
```

Exemplo de uso com o agente:

```text
Ana:     use o cooper: o que tenho pra fazer?

Claude:  → get_briefing
         Você tem 1 tarefa aguardando aceite: #7 "Tela de login com magic link", enviada pelo Bruno.
         O Bruno está com o Codex na #5, "Validação do token no middleware" (há 3 min).
         Quer que eu aceite a #7?

Ana:     aceita e começa

Claude:  → accept_task #7 → get_task_context #7 → start_task #7 (branch feat/login)
         → report_progress "Formulário pronto; integrando com Supabase Auth"
         ...
         → complete_task #7  resumo + commit a1b2c3d + "pnpm test: 42 passaram"
```

O painel do Bruno é atualizado em tempo real a cada um desses passos.

## Telas

| Agora: Pessoas | Agora: Equipe | Ajustes |
|---|---|---|
| <img src="docs/assets/screenshot-agora.png" alt="Visão Pessoas: um cartão por pessoa com a tarefa na cor dela e os limites de IA" width="300"> | <img src="docs/assets/screenshot-equipe.png" alt="Visão Equipe: lista com tarefa e folga de IA de cada pessoa" width="260"> | <img src="docs/assets/screenshot-ajustes.png" alt="Ajustes: repositório, só pessoas aprovam PRs, status em tempo real e nova skill" width="200"> |
| Um cartão por pessoa: tarefa na cor dela, o que o agente declarou, limites de 5 h e da semana por agente e branch | A folga de IA de cada um, para decidir para quem mandar trabalho; clicar abre o cartão da pessoa | Repositório do time, "Só pessoas aprovam PRs", hooks do Claude Code e do Codex e nova skill |

<p align="center">
  <img src="docs/assets/screenshot-compacto.png" alt="Modo compacto: a pessoa, a tarefa e o uso" width="420"><br>
  <sub>Modo compacto: a pessoa em foco, a tarefa, o limite de 5 h e o resto do time.</sub>
</p>

## Decisões de design

### Uso eficiente do contexto

Tudo o que o Cooper devolve ao agente ocupa espaço na janela de contexto da conversa. Por isso:

- `get_briefing` reúne numa chamada o que antes exigiria três ou quatro.
- As respostas são compactadas ([`compact.ts`](packages/mcp-server/src/compact.ts)): campos vazios são removidos e datas
  ISO são convertidas em tempo relativo ("há 5 min").
- As regras de comportamento são enviadas uma vez por conversa, nas instruções do servidor MCP. O `CLAUDE.md`/`AGENTS.md`
  apenas aponta para elas. Testes limitam as instruções a 900 caracteres e cada descrição de ferramenta a 220.
- O agente lista os blocos de contexto e lê apenas os que precisa. Para editar, troca um trecho em vez de reenviar o bloco inteiro.

### Origem das informações

O painel distingue o que foi declarado pelo agente do que foi observado:

| Selo | Significado |
|---|---|
| `declarado` | Informado pelo agente, sem verificação. |
| `hook` | Evento emitido pelo próprio Claude Code ou Codex ao executar algo. |
| `git local` / `GitHub` | Lido do repositório ou da API do GitHub. |
| `usuário` | Ação feita por uma pessoa no painel. |

O status "Executando" só aparece com evento recente de hook, que se liga em Ajustes → Agentes. Ao concluir uma tarefa, o agente envia evidências, como o
commit e o comando de teste executado.

### Controle humano

- O agente informa as tarefas aguardando aceite, mas só aceita, recusa, cria ou conclui tarefas quando a pessoa pede.
- O prompt de uma tarefa é tratado como descrição de trabalho e não como instrução de sistema, já que foi escrito por
  outra pessoa. Isso reduz o risco de *prompt injection* entre membros do time.
- Alterar o prompt de uma tarefa já aceita exige um novo aceite.
- Com **Só pessoas aprovam PRs** ligado, o agente não aprova nem faz merge de PR (o hook bloqueia) e não conclui tarefas:
  elas param em *Em revisão* até uma pessoa aprovar.
- O modo coordenador e o aceite automático vêm desligados; cada pessoa liga para si.
- A gravação do trecho do Cooper no `CLAUDE.md`/`AGENTS.md` de um repositório mostra antes o que será alterado em cada
  arquivo e só acontece após confirmação.

### Contexto compartilhado

O contexto do projeto é guardado em blocos versionados, com histórico e opção de desfazer. Qualquer agente do time pode
lê-los no início da conversa e atualizá-los quando aprende algo relevante. Edições simultâneas no mesmo bloco geram
conflito, que precisa ser resolvido antes de salvar.

### Privacidade e segurança

- O Cooper não lê nem armazena conversas ou código. Os agentes enviam apenas frases curtas de progresso (até 120
  caracteres), resumos de conclusão e, opcionalmente, nomes de arquivos.
- O uso de IA (tokens, modelo e percentual de limite) é lido localmente e só é compartilhado se a pessoa ativar. Ao
  desativar, os dados enviados são apagados.
- Os agentes não acessam as tabelas diretamente: usam apenas funções `mcp_*`, autenticadas por um token por agente,
  armazenado como hash e revogável.
- Cada time usa o próprio Supabase, e cada projeto é isolado por RLS, com testes automatizados (incluindo testes offline
  com PGlite).

## Situação

| | |
|---|---|
| Painel flutuante, modo compacto, atalho global, bandeja e notificações | ✅ |
| Tarefas em tempo real, com prompt, aceite/recusa e edição | ✅ |
| Contexto em blocos com versão, histórico e conflito | ✅ |
| Agentes por MCP, testado com Claude Code e Codex | ✅ |
| Contas, projetos, convites e código de conexão | ✅ |
| Uso de IA e limites (opcional) | ✅ |
| Instalador para Windows | ✅ |
| Subtarefas, comentários, anexos, prioridade e prazo | ✅ |
| Modo coordenador e aceite automático | ✅ |
| Resumo do contexto, com medida de quanto encolheu | ✅ |
| Skills do time como contexto (comandos no Claude Code) | ✅ |
| Repositório do time e branch/alterações locais (`git local`), escolhidos pelo app | ✅ |
| Status "Executando" por hooks (Claude Code e Codex) | ✅ |
| Só pessoas aprovam PRs (hook + proteção de branch do GitHub) | ✅ |
| Dependências com aviso, novidades no briefing, bloqueio, handoff, disponibilidade e limite de tarefas (0.8) | ✅ |
| Limite de tarefas abertas em ⚙ Ajustes (hoje só pela função `set_wip_limit`) | ⏳ |
| Integração com o GitHub: PRs, CI e revisão ligados à tarefa pela branch, acesso de escrita de cada um, commits das evidências conferidos no git local | ✅ |
| Um aviso por PR no briefing, PR também na tarefa-mãe e projeto novo com os blocos Decisões e Handoffs (0.8.1) | ✅ |
| Alerta quando dois agentes alteram os mesmos arquivos | ⏳ |
| Atualização automática do app | ⏳ |
| Envio do convite por e-mail pelo próprio Cooper | ⏳ |

## Começar

### 1. Instalar (Windows)

1. Baixe `Cooper_x.y.z_x64-setup.exe` em [Releases](../../releases).
2. Na primeira tela, escolha **Tenho um código de conexão**, se alguém do time enviou um convite, ou **Criar meu servidor**,
   se você está criando o time (guia em [docs/SETUP_SUPABASE.md](docs/SETUP_SUPABASE.md)).
3. Crie sua conta e entre no projeto.

> O instalador ainda não tem assinatura digital. Se o Windows exibir "aplicativo não reconhecido", clique em
> **Mais informações → Executar assim mesmo**.

### 2. Conectar o agente

1. No Cooper, abra **Ajustes → Agentes**, escolha **Claude Code** ou **Codex** e clique em **Gerar token**.
2. Clique em **Conectar**. O Cooper adiciona a entrada `cooper` à configuração de usuário do agente (`~/.claude.json` ou
   `~/.codex/config.toml`), com backup. Nenhum arquivo dos seus repositórios é alterado.
3. Abra uma conversa nova no agente e peça: *"use o cooper: o que tenho para fazer?"*

### 3. Uma vez por pessoa, em Ajustes (opcional)

- **Repositório**: o dono escolhe a pasta do projeto, e o repositório do GitHub dela vira o do time. Os outros apontam onde
  está a própria cópia. O time passa a ver branch e quantos arquivos cada um alterou (nunca nomes nem conteúdo).
- **Agentes → Status em tempo real**: liga os hooks do Claude Code e do Codex, com prévia e backup. O hook manda só o nome
  do evento. No Codex, aprove uma vez com `/hooks`.

### Atualizar o servidor

Quando uma versão nova muda o banco, o dono do time cola o arquivo de [`supabase/upgrades/`](supabase/upgrades/) que leva
da versão atual à nova (por exemplo `17-para-18.sql`) no **SQL Editor** do Supabase e clica em **Run**. É uma vez por time.
Quem instala do zero usa só o `supabase/install.sql`.

Requisito: Node.js 20 ou superior (o servidor MCP roda com `node`).

> Para os e-mails de confirmação chegarem a qualquer pessoa, configure um SMTP próprio no Supabase: [docs/EMAIL.md](docs/EMAIL.md).

> No Supabase, mantenha **"Confirm email"** ativado. O convite para um projeto é validado pelo e-mail da conta; sem
> confirmação, alguém poderia criar uma conta com o e-mail de outra pessoa e aceitar o convite.

## Arquitetura

```
apps/desktop          app de mesa (Tauri v2 + React 19 + Tailwind 4); leitura local de uso de IA em Rust
packages/mcp-server   servidor MCP (stdio) usado pelos agentes
packages/shared       tipos, esquemas Zod e regras de presença, uso e agentes
supabase/migrations   esquema, RLS e RPCs; supabase/install.sql reúne tudo; supabase/upgrades, de uma versão à outra
tests/sql             testes de SQL num Postgres em memória (PGlite)
tests/*.test.ts       testes de ponta a ponta contra um Supabase de testes
```

<details>
<summary><b>Desenvolvimento</b></summary>

Pré-requisitos: Node 24, pnpm, Rust (MSVC), Visual Studio Build Tools com C++ e WebView2.

```bash
pnpm install
pnpm dev:web       # só a interface, no navegador (http://localhost:1420; /?demo mostra um time fictício)
pnpm dev:desktop   # app Tauri
pnpm tauri build   # instalador (em apps/desktop)
```

Em `pnpm dev`, se o `.env` da raiz tiver `SUPABASE_URL` e `SUPABASE_ANON_KEY`, o app pula a tela de Setup.
O instalador não inclui essas constantes: cada pessoa escolhe o servidor.

**Testes**

```bash
pnpm typecheck
pnpm mcp:build && pnpm test        # unitários + SQL (PGlite, offline)
cd apps/desktop/src-tauri && cargo test
pnpm test:db                       # ponta a ponta: requer um Supabase de testes (.env), db:push e db:seed
```

**Banco**

```bash
pnpm db:install-sql   # regenera supabase/install.sql a partir das migrações
pnpm db:push          # aplica as migrações no Supabase do .env (SUPABASE_DB_URL)
pnpm db:seed          # usuários e dados de exemplo (senhas em .env.local)
```

</details>

Mais documentos: [o que é o Cooper](docs/O_QUE_E_O_COOPER.md) · [contexto para agentes](docs/CONTEXTO_COOPER.md) ·
[criar o servidor](docs/SETUP_SUPABASE.md) · [e-mail](docs/EMAIL.md) · [skills](docs/SKILLS.md) ·
[pesquisa de plataformas](docs/PESQUISA_PLATAFORMAS.md) · [histórico das fases](docs/historico/).

## Feito com agentes de IA

O Cooper foi construído do jeito que ele propõe que os times trabalhem: com agentes de IA.

- **Quem escreveu o código:** o [Claude Code](https://claude.com/claude-code) (modelo Claude, da Anthropic). Todos os
  commits deste repositório trazem o Claude como coautor (`Co-Authored-By: Claude`).
- **Papel da pessoa:** Alan Mateus Queiroz definiu o produto, tomou as decisões de design, pediu cada mudança, testou o
  app e decidiu o que entrava em cada versão.
- **Como garantimos a qualidade:** testes automáticos de banco (RLS, migrações e funções, num Postgres em memória), do
  servidor MCP e do app rodam em todo push (CI), e cada versão foi usada de verdade com Claude Code e Codex.
- **O próprio Cooper no processo:** a versão 0.8.1 nasceu de um teste de ponta a ponta em que um agente usou o Cooper
  para planejar, executar, revisar e entregar um projeto de exemplo, com PR e merge no GitHub.

## Licença

[MIT](LICENSE) © 2026 Alan Mateus Queiroz.
