# Skills compartilhadas (seção 3.5): investigação e proposta

Pesquisa feita em 28/10/2026. **Nada implementado ainda**, como pedia o documento.

## O que existe hoje

- **Skills são um formato aberto** (Agent Skills, SKILL.md): uma pasta com um `SKILL.md` e, opcionalmente, scripts e arquivos. O **Claude Code** e o **Codex** leem o mesmo formato; o Codex procura em `.codex/skills/` (projeto) ou `~/.codex/skills/` (usuário), segundo guias da comunidade — confirmar o caminho na doc oficial antes de construir.
- **Skills dentro do repositório já são compartilhadas pelo git**: se o time comita `.claude/skills/` (e o equivalente do Codex), todo mundo recebe no `git pull`. O Cooper não precisa fazer nada nesse caso.
- **Prompts do MCP**: um servidor MCP pode oferecer *prompts* além de ferramentas; no Claude Code eles aparecem como comandos `/mcp__<servidor>__<prompt>`. É um jeito de o Cooper distribuir "receitas" para as duas IAs sem copiar arquivos, mas são só textos (sem scripts nem arquivos anexos).

## Onde o Cooper ajudaria

1. **Skills do time fora do repositório** (ex.: "como revisar PR neste time", "checklist de deploy"), que hoje cada um tem só na própria máquina.
2. **Mesmo conteúdo para Claude Code e Codex**, sem manter duas cópias.

## Proposta (em ordem)

1. **Skills como prompts do MCP** — **feito (30/10/2026)**: um bloco de contexto com título `Skill: nome` vira o prompt `nome` do servidor `cooper` (no Claude Code, `/mcp__cooper__nome`), lido na hora do uso. Lista carregada quando o agente abre uma conversa. Falta confirmar se o Codex mostra prompts de servidores MCP.
2. **Exportar receita como skill** (médio): ⚙ → "Instalar como skill" grava `SKILL.md` em `~/.claude/skills/<nome>/` e `~/.codex/skills/<nome>/`, com a mesma prévia + confirmação que já usamos para `CLAUDE.md`/`AGENTS.md`.
3. **Não** construir um "marketplace" de skills: o ecossistema público já existe (agentskills.io e repositórios curados).

Antes de implementar: confirmar na doc oficial do Codex o caminho das skills e se o Codex lista *prompts* de servidores MCP.

## Fontes

- [OpenAI — Codex Agent Skills](https://developers.openai.com/codex/skills)
- [The Codex CLI Skills Ecosystem (comunidade)](https://codex.danielvaughan.com/2026/03/27/codex-cli-skills-ecosystem/)
- [Simon Willison — Model Context Protocol](https://feeds.simonwillison.net/2024/Nov/25/model-context-protocol)
- [Slash commands no Claude Code (comunidade)](https://claude.nagdy.me/learn/slash-commands)
