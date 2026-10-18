#!/usr/bin/env node
// Servidor MCP do Cooper (stdio). O cliente (Claude Code, Codex) inicia este processo.
// Toda chamada vai para uma RPC no Supabase que valida o token e restringe ao workspace dele.
// stdout é do protocolo MCP: logs só em stderr.
import { randomUUID } from "node:crypto";
import { progressTextSchema } from "@cooper/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const VERSION = "0.1.0";

const env = {
  token: process.env.COOPER_TOKEN ?? "",
  url: process.env.COOPER_SUPABASE_URL ?? "",
  anonKey: process.env.COOPER_SUPABASE_ANON_KEY ?? "",
};
const missing = Object.entries({ COOPER_TOKEN: env.token, COOPER_SUPABASE_URL: env.url, COOPER_SUPABASE_ANON_KEY: env.anonKey })
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`[cooper-mcp] variáveis ausentes: ${missing.join(", ")}`);
  process.exit(1);
}

const db = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
/** Uma sessão por processo: é o que o widget mostra como "sessão do agente". */
const session = randomUUID();

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

async function rpc(fn: string, args: Record<string, unknown> = {}): Promise<Result> {
  const { data, error } = await db.rpc(fn, { p_token: env.token, p_session: session, ...args });
  if (error) return { content: [{ type: "text", text: `Erro do Cooper: ${error.message}` }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(data ?? { ok: true }) }] };
}

const server = new McpServer(
  { name: "cooper", version: VERSION },
  {
    instructions: [
      "Cooper sincroniza o trabalho do time entre pessoas e agentes.",
      "No início: chame get_workspace_context e get_my_tasks; antes de mexer em arquivos, get_team_status para evitar sobreposição.",
      "Ao começar uma tarefa: start_task com o número (#N) e a branch.",
      "A cada passo relevante (não a cada arquivo): report_progress com até 120 caracteres.",
      "Tudo o que você registra aparece para o time marcado como 'declarado'. Não conclua tarefas: isso é humano.",
    ].join("\n"),
  },
);

const taskNumber = z.number().int().positive().describe("Número da tarefa, sem o #. Ex.: 12");

server.registerTool(
  "get_workspace_context",
  {
    title: "Contexto do workspace",
    description: "Resumo do projeto, arquitetura, convenções e decisões técnicas aprovadas. Curto; chame uma vez por sessão.",
    inputSchema: {},
  },
  () => rpc("mcp_get_workspace_context"),
);

server.registerTool(
  "get_my_tasks",
  {
    title: "Minhas tarefas",
    description: "Tarefas atribuídas a quem é dono deste token, ainda não concluídas.",
    inputSchema: {},
  },
  () => rpc("mcp_get_my_tasks"),
);

server.registerTool(
  "get_task_context",
  {
    title: "Contexto da tarefa",
    description: "Detalhes, critérios de aceite, vínculos (branch/commit/PR), dependências, decisões e eventos recentes de uma tarefa.",
    inputSchema: { task_number: taskNumber },
  },
  ({ task_number }) => rpc("mcp_get_task_context", { p_number: task_number }),
);

server.registerTool(
  "start_task",
  {
    title: "Iniciar tarefa",
    description:
      "Registra que você começou a tarefa: move de Backlog para Em andamento, assume se estiver sem responsável e vincula a branch.",
    inputSchema: {
      task_number: taskNumber,
      branch: z
        .string()
        .max(200)
        .regex(/^[A-Za-z0-9._/-]+$/)
        .optional()
        .describe("Branch git onde o trabalho acontece"),
    },
  },
  ({ task_number, branch }) => rpc("mcp_start_task", { p_number: task_number, p_branch: branch ?? null }),
);

server.registerTool(
  "report_progress",
  {
    title: "Reportar progresso",
    description:
      "Frase curta (até 120 caracteres) sobre o que você está fazendo agora. Opcional: arquivos tocados e testes rodados. Sem a tarefa, usa a tarefa iniciada nesta sessão.",
    inputSchema: {
      text: progressTextSchema.describe("Ex.: 'Criando validação de QR expirado'"),
      task_number: taskNumber.optional(),
      files: z.array(z.string().max(300)).max(50).optional().describe("Caminhos relativos ao repositório"),
      tests: z.object({ command: z.string().max(200), passed: z.boolean() }).optional(),
    },
  },
  ({ text, task_number, files, tests }) =>
    rpc("mcp_report_progress", { p_text: text, p_number: task_number ?? null, p_files: files ?? null, p_tests: tests ?? null }),
);

server.registerTool(
  "get_team_status",
  {
    title: "Status do time",
    description:
      "O que os outros membros estão fazendo agora: agente, tarefa, atividade declarada, branch e arquivos não commitados. Use para evitar mexer nos mesmos arquivos.",
    inputSchema: {},
  },
  () => rpc("mcp_get_team_status"),
);

// Encerra a sessão no Cooper quando o cliente fecha o processo (melhor esforço).
let ending = false;
async function shutdown() {
  if (ending) return;
  ending = true;
  await Promise.race([db.rpc("mcp_end_session", { p_token: env.token, p_session: session }), new Promise((r) => setTimeout(r, 1500))]);
  process.exit(0);
}
process.stdin.on("close", () => void shutdown());
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await server.connect(new StdioServerTransport());
console.error(`[cooper-mcp] ${VERSION} pronto (sessão ${session.slice(0, 8)})`);
