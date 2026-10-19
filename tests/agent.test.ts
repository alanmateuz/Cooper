// Fase 2: tokens de agente, RPCs do MCP e teste de ponta a ponta com dois clientes MCP reais (stdio).
// Pré-requisitos: pnpm db:push, pnpm db:seed e pnpm --filter @cooper/mcp-server build.
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} ausente: rode pnpm db:seed antes`);
  return v;
};
const SERVER = fileURLToPath(new URL("../packages/mcp-server/dist/index.js", import.meta.url));
const anon = () => createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
const session = () => `teste-${crypto.randomUUID()}`;

async function signIn(who: "ALAN" | "BIA"): Promise<SupabaseClient> {
  const c = anon();
  const { error } = await c.auth.signInWithPassword({ email: env(`TEST_${who}_EMAIL`), password: env(`TEST_${who}_PASSWORD`) });
  if (error) throw error;
  return c;
}

async function mcpClient(token: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { ...process.env, COOPER_TOKEN: token, COOPER_SUPABASE_URL: SUPABASE_URL!, COOPER_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY! } as Record<string, string>,
    stderr: "ignore",
  });
  const client = new Client({ name: "cooper-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

async function call(c: Client, name: string, args: Record<string, unknown> = {}) {
  const r = (await c.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  if (r.isError) throw new Error(r.content[0]?.text);
  return JSON.parse(r.content[0]!.text);
}

describe.skipIf(!SUPABASE_URL || !SUPABASE_ANON_KEY)("RPCs de agente: segurança", () => {
  const db = anon();

  it("token inválido é recusado", async () => {
    const { error } = await db.rpc("mcp_get_my_tasks", { p_token: "coop_" + "0".repeat(48), p_session: session() });
    expect(error?.message).toMatch(/token inválido/);
    const bad = await db.rpc("mcp_get_my_tasks", { p_token: "qualquer coisa", p_session: session() });
    expect(bad.error).not.toBeNull();
  });

  it("funções internas não são expostas", async () => {
    const { error } = await db.rpc("agent_auth", { p_token: env("TEST_ALAN_AGENT_TOKEN") });
    expect(error).not.toBeNull();
  });

  it("token de outro workspace não vê tarefas nem membros do demo", async () => {
    const tok = env("TEST_INTRUSO_AGENT_TOKEN");
    const t1 = await db.rpc("mcp_get_task_context", { p_token: tok, p_session: session(), p_number: 1 });
    expect(t1.error).toBeNull();
    expect(t1.data.title).toBe("Tarefa secreta de outro time"); // o #1 DELE, não o do demo
    const t2 = await db.rpc("mcp_get_task_context", { p_token: tok, p_session: session(), p_number: 2 });
    expect(t2.error?.message).toMatch(/não existe/);
    const team = await db.rpc("mcp_get_team_status", { p_token: tok, p_session: session() });
    expect(JSON.stringify(team.data)).not.toMatch(/Alan|Bia/);
    const ctx = await db.rpc("mcp_get_workspace_context", { p_token: tok, p_session: session() });
    expect(ctx.data.workspace).toBe("Outro (isolamento)");
  });

  it("token de outro workspace não escreve no demo", async () => {
    // número que só existe no demo: falha; o #1 dele grava só no workspace dele
    const r = await db.rpc("mcp_start_task", { p_token: env("TEST_INTRUSO_AGENT_TOKEN"), p_session: session(), p_number: 3 });
    expect(r.error).not.toBeNull();
  });

  it("valida payload: texto > 120, branch inválida, tests malformado", async () => {
    const tok = env("TEST_ALAN_AGENT_TOKEN");
    const long = await db.rpc("mcp_report_progress", { p_token: tok, p_session: session(), p_text: "x".repeat(121) });
    expect(long.error).not.toBeNull();
    const br = await db.rpc("mcp_start_task", { p_token: tok, p_session: session(), p_number: 1, p_branch: "x; rm -rf /" });
    expect(br.error).not.toBeNull();
    const tests = await db.rpc("mcp_report_progress", { p_token: tok, p_session: session(), p_text: "ok", p_tests: { command: "x" } });
    expect(tests.error).not.toBeNull();
  });

  it("anônimo não cria token; token revogado para de funcionar", async () => {
    const a = await db.rpc("create_agent_token", { p_workspace: crypto.randomUUID(), p_kind: "codex" });
    expect(a.error).not.toBeNull();

    const alan = await signIn("ALAN");
    const ws = (await alan.from("workspaces").select("id").eq("name", "Hacko (demo)").single()).data!;
    const created = await alan.rpc("create_agent_token", { p_workspace: ws.id, p_kind: "other", p_label: "teste revogação" });
    expect(created.error).toBeNull();
    const ok = await db.rpc("mcp_get_my_tasks", { p_token: created.data.token, p_session: session() });
    expect(ok.error).toBeNull();
    await alan.from("agent_connections").update({ revoked_at: new Date().toISOString() }).eq("id", created.data.id);
    const after = await db.rpc("mcp_get_my_tasks", { p_token: created.data.token, p_session: session() });
    expect(after.error?.message).toMatch(/revogado/);
  });

  it("usuário não cria token em workspace do qual não é membro", async () => {
    const bia = await signIn("BIA");
    const r = await bia.rpc("create_agent_token", { p_workspace: crypto.randomUUID(), p_kind: "codex" });
    expect(r.error).not.toBeNull();
  });
});

describe.skipIf(!SUPABASE_URL || !SUPABASE_ANON_KEY)("MCP de ponta a ponta: dois clientes", () => {
  let codexAlan: Client, claudeBia: Client;

  beforeAll(async () => {
    [codexAlan, claudeBia] = await Promise.all([mcpClient(env("TEST_ALAN_AGENT_TOKEN")), mcpClient(env("TEST_BIA_AGENT_TOKEN"))]);
  }, 30_000);
  afterAll(async () => {
    await Promise.all([codexAlan?.close(), claudeBia?.close()]);
  });

  it("expõe as ferramentas do MCP", async () => {
    const { tools } = await codexAlan.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "get_my_tasks", "get_task_context", "get_team_status", "get_workspace_context", "report_progress", "start_task",
        "create_task", "accept_task", "decline_task", "complete_task",
        "update_context_block", "create_context_block",
      ].sort(),
    );
  });

  it("critério 3: um cliente consulta suas tarefas", async () => {
    const mine = await call(codexAlan, "get_my_tasks");
    expect(mine.tasks.some((t: { number: number }) => t.number === 1)).toBe(true);
    const ctx = await call(codexAlan, "get_task_context", { task_number: 1 });
    expect(ctx.acceptance_criteria).toMatch(/QR/);
  });

  it("critérios 4 e 5: progresso de um chega ao outro cliente e ao widget (Realtime)", async () => {
    const text = `Teste e2e ${new Date().toISOString().slice(11, 19)}`;

    // "widget" da Bia: cliente logado ouvindo agent_sessions pelo Realtime
    const bia = await signIn("BIA");
    const ws = (await bia.from("workspaces").select("id").eq("name", "Hacko (demo)").single()).data!;
    const seen = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Realtime não entregou em 15 s")), 15_000);
      bia
        .channel(`teste-${Date.now()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "agent_sessions", filter: `workspace_id=eq.${ws.id}` }, (p) => {
          const row = p.new as { activity_text?: string };
          if (row.activity_text === text) {
            clearTimeout(timer);
            resolve(row.activity_text);
          }
        })
        .subscribe();
    });
    await new Promise((r) => setTimeout(r, 1500)); // dá tempo da assinatura entrar

    await call(codexAlan, "start_task", { task_number: 1, branch: "codex/qrcode-inscricao" });
    await call(codexAlan, "report_progress", { text, files: ["lib/qr/validate.ts"], tests: { command: "pnpm test qr", passed: true } });

    const team = await call(claudeBia, "get_team_status");
    const alan = team.find((p: { name: string }) => p.name.startsWith("Alan"));
    expect(alan.sessions.some((s: { activity: string; agent: string }) => s.activity === text && s.agent === "codex")).toBe(true);

    expect(await seen).toBe(text);

    // evento registrado com origem "declarado"
    const ev = await bia.from("task_events").select("source,payload").eq("workspace_id", ws.id).eq("type", "report_progress")
      .order("occurred_at", { ascending: false }).limit(1).single();
    expect(ev.data!.source).toBe("agent_declared");
    expect(ev.data!.payload.text).toBe(text);
    await bia.removeAllChannels();
  }, 40_000);

  it("ferramenta com tarefa inexistente retorna erro legível, sem derrubar o servidor", async () => {
    await expect(call(claudeBia, "get_task_context", { task_number: 9999 })).rejects.toThrow(/não existe/);
    const mine = await call(claudeBia, "get_my_tasks");
    expect(Array.isArray(mine.awaiting_acceptance) && Array.isArray(mine.tasks)).toBe(true);
  });
});
