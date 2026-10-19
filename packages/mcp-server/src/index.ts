#!/usr/bin/env node
// Servidor MCP do Cooper (stdio). O cliente (Claude Code, Codex) inicia este processo.
// Toda chamada vai para uma RPC no Supabase que valida o token e restringe ao workspace dele.
// stdout é do protocolo MCP: logs só em stderr.
import { randomUUID } from "node:crypto";
import { AGENT_RULES, declineReasonSchema, progressTextSchema } from "@cooper/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { compact } from "./compact";

/** Versão do package.json, injetada pelo build (build.mjs). */
declare const __COOPER_VERSION__: string;
const VERSION = typeof __COOPER_VERSION__ === "string" ? __COOPER_VERSION__ : "dev";

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
  // Conflito de versão no contexto: nada foi gravado; a resposta traz o conteúdo atual para mesclar.
  const conflict = !!data && typeof data === "object" && (data as { conflict?: unknown }).conflict === true;
  return { content: [{ type: "text", text: JSON.stringify(compact(data ?? { ok: true })) }], ...(conflict ? { isError: true } : {}) };
}

const server = new McpServer(
  { name: "cooper", version: VERSION },
  {
    instructions: ["Cooper sincroniza o trabalho do time entre pessoas e agentes.", ...AGENT_RULES].join("\n"),
  },
);

const taskNumber = z.number().int().positive().describe("Número da tarefa, sem o #. Ex.: 12");

server.registerTool(
  "get_workspace_context",
  {
    title: "Contexto do workspace",
    description:
      "Contexto do projeto em blocos. Sem argumentos: lista (título, versão, prévia). Com blocks: o conteúdo desses blocos.",
    inputSchema: {
      blocks: z.array(z.string().max(120)).max(20).optional().describe("Títulos (ou ids) dos blocos cujo conteúdo você quer"),
    },
  },
  ({ blocks }) => rpc("mcp_get_workspace_context", { p_blocks: blocks?.length ? blocks : null }),
);

server.registerTool(
  "update_context_block",
  {
    title: "Atualizar bloco de contexto",
    description:
      "Substitui o conteúdo inteiro de um bloco. Se base_version estiver velha, nada é gravado e volta o conteúdo atual: mescle e reenvie. Para mudar só um trecho, prefira patch_context_block.",
    inputSchema: {
      block: z.string().min(1).max(120).describe("Título ou id do bloco"),
      content: z.string().max(20000).describe("Conteúdo completo novo"),
      base_version: z.number().int().positive().describe("Versão do bloco que você leu"),
      title: z.string().trim().min(1).max(120).optional().describe("Novo título, se for renomear"),
    },
  },
  ({ block, content, base_version, title }) =>
    rpc("mcp_update_context_block", { p_block: block, p_content: content, p_base_version: base_version, p_title: title ?? null }),
);

server.registerTool(
  "create_context_block",
  {
    title: "Criar bloco de contexto",
    description: "Cria um bloco de contexto. Se o assunto já tem bloco, edite o existente.",
    inputSchema: {
      title: z.string().trim().min(1).max(120),
      content: z.string().max(20000),
    },
  },
  ({ title, content }) => rpc("mcp_create_context_block", { p_title: title, p_content: content }),
);

server.registerTool(
  "get_briefing",
  {
    title: "Briefing",
    description: "Numa chamada: tarefas aguardando seu aceite, suas tarefas abertas, as que você enviou e foram recusadas, e o que cada pessoa do time está fazendo (agente, tarefa, branch, arquivos não commitados).",
    inputSchema: {},
  },
  () => rpc("mcp_get_briefing"),
);

server.registerTool(
  "patch_context_block",
  {
    title: "Editar trecho do contexto",
    description: "Edita um bloco sem reenviar tudo: append (acrescenta ao final) ou old_text→new_text (o trecho precisa aparecer uma vez só).",
    inputSchema: {
      block: z.string().min(1).max(120).describe("Título ou id do bloco"),
      append: z.string().min(1).max(20000).optional(),
      old_text: z.string().min(1).max(20000).optional(),
      new_text: z.string().max(20000).optional(),
    },
  },
  ({ block, append, old_text, new_text }) =>
    rpc("mcp_patch_context_block", { p_block: block, p_append: append ?? null, p_old: old_text ?? null, p_new: new_text ?? null }),
);

server.registerTool(
  "get_task_context",
  {
    title: "Contexto da tarefa",
    description: "Prompt, quem enviou, descrição, critérios, vínculos, dependências e progresso recente de uma tarefa.",
    inputSchema: {
      task_number: taskNumber,
      summary: z.boolean().optional().describe("Incluir o bloco de resumo do projeto"),
    },
  },
  ({ task_number, summary }) => rpc("mcp_get_task_context", { p_number: task_number, p_summary: summary ?? false }),
);

server.registerTool(
  "start_task",
  {
    title: "Iniciar tarefa",
    description: "Marca a tarefa como Em andamento e vincula a branch.",
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
    description: "O que você está fazendo agora (até 120 caracteres). Sem task_number, usa a tarefa iniciada nesta sessão.",
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
  "create_task",
  {
    title: "Criar tarefa",
    description: "Cria uma tarefa. Para outra pessoa, fica aguardando aceite; para o próprio usuário (padrão), já nasce aceita.",
    inputSchema: {
      title: z.string().trim().min(1).max(200),
      prompt: z.string().max(20000).optional().describe("O que a IA de quem receber deve executar"),
      assigned_to: z.string().max(200).optional().describe("Nome ou e-mail de um membro. Omitido: o próprio usuário"),
    },
  },
  ({ title, prompt, assigned_to }) =>
    rpc("mcp_create_task", { p_title: title, p_prompt: prompt ?? null, p_assignee: assigned_to ?? null }),
);

server.registerTool(
  "accept_task",
  {
    title: "Aceitar tarefa",
    description: "Aceita uma tarefa enviada ao usuário.",
    inputSchema: { task_number: taskNumber },
  },
  ({ task_number }) => rpc("mcp_accept_task", { p_number: task_number }),
);

server.registerTool(
  "decline_task",
  {
    title: "Recusar tarefa",
    description: "Recusa uma tarefa enviada ao usuário, com motivo (quem enviou vê).",
    inputSchema: { task_number: taskNumber, reason: declineReasonSchema.describe("Motivo, até 500 caracteres") },
  },
  ({ task_number, reason }) => rpc("mcp_decline_task", { p_number: task_number, p_reason: reason }),
);

server.registerTool(
  "complete_task",
  {
    title: "Concluir tarefa",
    description: "Conclui a tarefa com resumo curto e evidências (commit, comando de teste). Sem task_number, usa a iniciada nesta sessão.",
    inputSchema: {
      summary: z.string().trim().min(1).max(1000),
      task_number: taskNumber.optional(),
      evidence: z.array(z.string().min(1).max(300)).max(10).optional(),
    },
  },
  ({ summary, task_number, evidence }) =>
    rpc("mcp_complete_task", { p_summary: summary, p_number: task_number ?? null, p_evidence: evidence ?? null }),
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
