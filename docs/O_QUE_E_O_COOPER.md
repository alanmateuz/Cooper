# Cooper

> Um painel pequeno, sempre visível no canto da tela, que mostra **quem do time está trabalhando, com qual agente de IA, em quê e com qual contexto**.

---

## O problema

Quando duas pessoas usam agentes de IA (Codex, Claude Code) no mesmo projeto:

- uma não sabe o que a outra está fazendo agora;
- os agentes não sabem o que o agente da outra pessoa está fazendo e podem mexer nos mesmos arquivos;
- o GitHub só mostra o que já foi commitado e enviado, não o que está acontecendo na máquina de cada um;
- a lista de tarefas fica desatualizada.

## O que o Cooper faz

O Cooper é como um **mini-player do time**: fica por cima das outras janelas e responde, num relance:

| Pergunta | Onde aparece |
|---|---|
| Quem está trabalhando agora? | Um cartão por pessoa, com um ponto de status |
| Com qual agente? | "Alan · Codex", "Bia · Claude Code" |
| Em quê? | Tarefa atual (#1, #2…) e a última frase de progresso |
| Onde? | Branch e alterações locais *(em construção: Fase 3)* |
| Qual o contexto do projeto? | Aba **Contexto**: resumo, arquitetura, convenções |
| Tem risco de conflito? | Alertas no topo *(em construção: Fase 4)* |

Ele **não** programa, não substitui o Codex nem o Claude Code e não é um Jira. Cada pessoa continua usando suas ferramentas normalmente; o Cooper só **sincroniza o contexto, as tarefas e o progresso**.

## Como funciona

```
 Você                                   Seu amigo
 ┌──────────────┐                      ┌──────────────┐
 │ Widget Cooper│◄──── tempo real ────►│ Widget Cooper│
 └──────┬───────┘          │           └──────┬───────┘
        │            ┌─────┴─────┐            │
        │            │  Supabase │  (banco online, compartilhado)
        │            └─────┬─────┘            │
 ┌──────┴───────┐          │           ┌──────┴───────┐
 │ Codex /      │── MCP ───┴─── MCP ───│ Claude Code /│
 │ Claude Code  │                      │ Codex        │
 └──────────────┘                      └──────────────┘
```

1. **O widget** mostra o time e as tarefas e se atualiza sozinho, sem recarregar.
2. **O agente de IA** de cada pessoa se conecta ao Cooper por **MCP**, um padrão para dar ferramentas a agentes. Com isso ele consegue:
   - ler as tarefas e o contexto do projeto;
   - dizer "comecei a tarefa #1" e "estou fazendo X";
   - perguntar "o que o resto do time está fazendo?", para não mexer nos mesmos arquivos.
3. **O banco online** (Supabase) guarda tudo e entrega as mudanças em tempo real para todos.

## De onde vem cada informação

Todo dado no widget mostra a sua **origem** num selo pequeno, porque nem tudo tem o mesmo grau de confiança:

| Selo | Significa |
|---|---|
| `declarado` | O agente disse. Ninguém conferiu. |
| `hook` | O próprio Codex ou Claude Code avisou que executou algo. É observado, não dito. *(Fase 4)* |
| `git local` | Lido do repositório na máquina da pessoa. *(Fase 3)* |
| `GitHub` | Veio do GitHub. *(Fase 3)* |
| `usuário` | Uma pessoa fez pelo widget. |

O status **"Executando"** só aparece com evidência recente (hook). Ter uma branch ou uma tarefa "em andamento" não basta.

## Usando o widget

- **Arrastar:** pela barra do topo.
- **— (recolher):** vira uma pílula pequena só com os avatares. Duplo clique na pílula reabre.
- **Expandir:** mostra as abas no rodapé:
  - 👥 **Agora**: o time;
  - ☰ **Tarefas**: criar (digite e Enter), mudar status, ver detalhes;
  - 📖 **Contexto**: o resumo do projeto;
  - 〰 **Atividade**: os últimos eventos;
  - ⚙ **Configurações**: membros, convites, agentes, tema.
- **Ctrl+Shift+Espaço:** mostra ou oculta de qualquer lugar.
- **Ícone na bandeja** (perto do relógio): mostrar/ocultar, pausar sincronização, sair.

## Começar a usar em dupla

**Quem começa o time (uma vez):**
1. Crie o servidor do time no Supabase (grátis): passo a passo em [SETUP_SUPABASE.md](SETUP_SUPABASE.md).
2. Instale e abra o Cooper → **Criar meu servidor** → cole a URL e a chave anon → **Criar conta**.
3. Crie o projeto (ex.: "Hacko").
4. ⚙ → **Equipe** → digite o e-mail do seu amigo → **Convidar** → **Copiar código de conexão**.
5. Mande para ele o instalador e o código.

**Quem foi convidado:**
1. Instale e abra o Cooper → **Tenho um código de conexão** → cole o código.
2. **Criar conta**, com **o mesmo e-mail que foi convidado**, e confirme pelo link do e-mail
   (se a página do link der erro, a conta fica confirmada mesmo assim).
3. Entre no Cooper: o convite aparece → **Entrar**.

**Cada um conecta o próprio agente:**
1. ⚙ → **Agentes** → escolha *Claude Code* ou *Codex* → **Gerar token** → **Conectar**.
2. Abra uma conversa nova no agente e peça, por exemplo: *"use o cooper: o que tenho para fazer?"*

Requisito para o passo dos agentes: **Node.js 20 ou mais novo** instalado.

## Privacidade

- O Cooper **não lê nem guarda conversas** com os agentes, nem o conteúdo do código.
- Os agentes só enviam frases curtas de progresso (até 120 caracteres) e, se quiserem, nomes de arquivos.
- Cada projeto é isolado: quem não é membro não vê nada. Há testes automáticos que provam isso.
- Os tokens dos agentes são guardados só como *hash*. Dá para revogar a qualquer momento em ⚙ → **Agentes**.

## O que já funciona e o que vem depois

| | Situação |
|---|---|
| Widget flutuante, pílula, atalho, bandeja | ✅ funcionando |
| Tarefas compartilhadas em tempo real | ✅ funcionando |
| Contas, projetos e convites | ✅ funcionando |
| Agentes conectados por MCP (Codex e Claude Code) | ✅ testado com os dois de verdade |
| Instalador para Windows | ✅ funcionando (Releases do GitHub) |
| Cada time com o próprio servidor (Setup, código de conexão) | ✅ funcionando |
| Editar tarefa, renomear/apagar/sair do projeto, remover membro, trocar senha | ✅ funcionando |
| Branch, commits e alterações locais reais | ⏳ Fase 3 |
| GitHub (pushes, PRs, CI) | ⏳ Fase 3 |
| Status "Executando" real (hooks) e alertas de conflito | ⏳ Fase 4 |
| Resumos automáticos com IA | ⏳ Fase 5 |

> Branch e "arquivos não commitados" só aparecem quando a leitura do git local existir (Fase 3). Até lá, esses campos ficam vazios.
