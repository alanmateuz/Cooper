# O que trazer do Trello, Jira e Linear para o Cooper

Pesquisa feita em 28/10/2026. Critério: só entra o que ajuda **pessoas e IAs** a dividir e acompanhar trabalho, sem virar um Jira.

## Achados

| Plataforma | Recurso | Como funciona lá |
|---|---|---|
| Trello | **Automação (antigo Butler)** | Regras "gatilho → condição → ação": mudar prazo, completar checklist, pôr etiqueta. Hoje é nativo, não um Power-Up. |
| Trello | **Checklists com responsável e prazo** | Itens de checklist podem ter pessoa e data e aparecem no calendário. |
| Trello | **Power-Ups** | Mais de 200 extensões de terceiros. |
| Jira | **Painel de desenvolvimento** | A chave da issue no nome da branch, no commit ou no PR liga tudo isso à issue, inclusive o pipeline. |
| Jira | **Smart Commits** | Comandos no texto do commit comentam, registram tempo ou mudam o status da issue. |
| Linear | **Sub-issues com fechamento automático** | Quando todas as sub-issues fecham, a mãe fecha; fechar a mãe fecha as que faltam. |
| Linear | **Palavras mágicas no commit/PR** | "fixes", "close" etc. mudam o status da issue ligada. |
| Linear | **Triagem** | Caixa de entrada para o que chega de fora, com escala de quem atribui. |
| Linear | **Ciclos e arquivamento automático** | Ciclos curtos de foco; fecha o que está parado há muito tempo e arquiva concluídos. |

## O que já temos parecido

- **Triagem** ≈ "Aguardando seu aceite" + aceite automático.
- **Atribuição inteligente** ≈ modo coordenador (`get_team_workload`), que o Linear não tem: lá a escala é fixa; aqui a IA vê o limite de cada um.

## Proposta (por valor para o Cooper)

1. **Subtarefas com fechamento automático** (Linear). A IA coordenadora divide uma tarefa grande em partes para pessoas diferentes; quando todas terminam, a tarefa-mãe vai para revisão sozinha. → *feito nesta noite*
2. **Comentários na tarefa** (Trello/Jira). Conversa curta sobre a tarefa entre pessoas e IAs ("o endpoint mudou, use /v2"), sem precisar de WhatsApp. As IAs leem e escrevem. → *feito nesta noite*
3. **Prioridade e prazo** (todos). Chip de prioridade, prazo com aviso de atraso, ordenação. A IA coordenadora usa isso para decidir o que vem primeiro. → *feito nesta noite*
4. **Palavras mágicas e painel de desenvolvimento** (Jira/Linear). `#12` na branch ou no commit liga à tarefa; "fecha #12" num PR com merge conclui como **verificado**. → entra na etapa de git/GitHub.
5. **Automações simples** (Butler), em forma de chaves prontas, não um editor de regras: "ao concluir todas as subtarefas → revisão", "tarefa parada há 3 dias → aviso". → depois do item 4.
6. **Quadro Kanban na janela larga** (Trello). Com o widget redimensionável, a aba Tarefas pode virar colunas por status quando houver espaço.
7. **Arquivar concluídas antigas** (Linear). Esconde da lista o que foi concluído há mais de 14 dias.

Fora de propósito por enquanto: Power-Ups de terceiros, ciclos/sprints formais, registro de horas.

## Fontes

- [Trello workflow automation with Butler (Atlassian)](https://www.atlassian.com/blog/trello/butler-power-up-trello-automation)
- [Trello — advanced features](https://trello.com/guide/enterprise/advanced-features)
- [GitLab — Jira development panel](https://docs.gitlab.com/integration/jira/development_panel)
- [Atlassian — processing issues with Smart Commits](https://confluence.atlassian.com/jirasoftwarecloud/processing-issues-with-smart-commits-788960027.html)
- [Linear — auto-close parent and sub-issues](https://linear.app/changelog/2024-09-06-auto-close-parent-and-sub-issues)
- [Linear — auto-close and auto-archive](https://linear.app/changelog/2020-08-19-auto-close-and-auto-archive)
- [Linear — documentação](https://docs.linear.app)
