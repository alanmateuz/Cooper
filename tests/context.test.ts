// Etapa 4 da nova direção: contexto compartilhado livre, em blocos, com histórico (critérios da seção 3.3).
// Pré-requisitos: pnpm db:push, pnpm db:seed e pnpm mcp:build.
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
const uniq = (s: string) => `${s} ${crypto.randomUUID().slice(0, 6)}`;

async function signIn(who: "ALAN" | "BIA" | "INTRUSO"): Promise<{ c: SupabaseClient; id: string }> {
  const c = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: env(`TEST_${who}_EMAIL`), password: env(`TEST_${who}_PASSWORD`) });
  if (error) throw error;
  return { c, id: data.user.id };
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

/** Chamada MCP; devolve { isError, data } sem lançar, porque conflito é uma resposta esperada. */
async function tool(c: Client, name: string, args: Record<string, unknown> = {}) {
  const r = (await c.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const text = r.content[0]!.text;
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // mensagem de erro em texto
  }
  return { isError: !!r.isError, data: data as Record<string, any> };
}

describe.skipIf(!SUPABASE_URL || !SUPABASE_ANON_KEY)("contexto em blocos", () => {
  let alan: { c: SupabaseClient; id: string }, bia: { c: SupabaseClient; id: string }, intruso: { c: SupabaseClient; id: string };
  let ws: string;
  let agentBia: Client, agentIntruso: Client;

  const create = async (title: string, content: string) => {
    const r = await alan.c.rpc("context_create", { p_workspace: ws, p_title: title, p_content: content });
    if (r.error) throw r.error;
    return r.data as { id: string; version: number; title: string };
  };
  const block = async (id: string) => (await alan.c.from("context_blocks").select("*").eq("id", id).single()).data!;

  beforeAll(async () => {
    [alan, bia, intruso] = await Promise.all([signIn("ALAN"), signIn("BIA"), signIn("INTRUSO")]);
    ws = (await alan.c.from("workspaces").select("id").eq("name", "Hacko (demo)").single()).data!.id;
    [agentBia, agentIntruso] = await Promise.all([mcpClient(env("TEST_BIA_AGENT_TOKEN")), mcpClient(env("TEST_INTRUSO_AGENT_TOKEN"))]);
  }, 30_000);
  afterAll(async () => {
    await Promise.all([agentBia?.close(), agentIntruso?.close()]);
  });

  it("critério 1: o que uma pessoa grava, a IA da outra lê; a lista padrão traz só prévia", async () => {
    const title = uniq("Arquitetura");
    const content = "React + Vinext em Workers. ".repeat(20);
    await create(title, content);

    const list = await tool(agentBia, "get_workspace_context");
    const item = list.data.blocks.find((b: { title: string }) => b.title === title);
    expect(item).toMatchObject({ version: 1, chars: content.length });
    expect(item.preview.length).toBeLessThanOrEqual(160);
    expect(item).not.toHaveProperty("content");

    const full = await tool(agentBia, "get_workspace_context", { blocks: [title.toLowerCase(), "Não existe"] });
    expect(full.data.blocks).toEqual([expect.objectContaining({ title, version: 1, content })]);
    expect(full.data.not_found).toEqual(["Não existe"]);
  });

  it("critério 2: a IA atualiza um bloco; a pessoa vê quem mudou, o histórico e consegue desfazer", async () => {
    const title = uniq("Convenções");
    const b = await create(title, "branches claude/<tema>");

    const up = await tool(agentBia, "update_context_block", { block: title, content: "branches claude/<tema> ou codex/<tema>", base_version: 1 });
    expect(up.isError).toBe(false);
    expect(up.data).toMatchObject({ ok: true, version: 2 });

    const now = await block(b.id);
    expect(now).toMatchObject({ version: 2, content: "branches claude/<tema> ou codex/<tema>", updated_by: bia.id, updated_source: "agent_declared", updated_agent: "claude_code" });

    const hist = (await alan.c.from("context_block_history").select("*").eq("block_id", b.id)).data!;
    expect(hist).toEqual([expect.objectContaining({ version: 1, content: "branches claude/<tema>", written_by: alan.id, replaced_by: bia.id, replaced_source: "agent_declared", action: "update" })]);

    const ev = (await alan.c.from("task_events").select("source,user_id,payload").eq("type", "context_updated").eq("workspace_id", ws)
      .order("occurred_at", { ascending: false }).limit(1).single()).data!;
    expect(ev).toMatchObject({ source: "agent_declared", user_id: bia.id, payload: { block_id: b.id, block_title: title, version: 2, action: "update" } });

    // desfazer = restaurar a v1, gerando a v3 (nada é apagado do histórico)
    const undo = await alan.c.rpc("context_restore", { p_block: b.id, p_version: 1, p_base_version: 2 });
    expect(undo.data).toMatchObject({ ok: true, version: 3 });
    expect(await block(b.id)).toMatchObject({ version: 3, content: "branches claude/<tema>", updated_by: alan.id, updated_source: "user" });
    expect((await alan.c.from("context_block_history").select("version").eq("block_id", b.id)).data!.map((h) => h.version).sort()).toEqual([1, 2]);
  });

  it("critério 3: duas edições sobre a mesma versão — a segunda é recusada com o conteúdo atual, sem perder dados", async () => {
    const b = await create(uniq("Contratos de API"), "GET /eventos");
    const first = await alan.c.rpc("context_update", { p_block: b.id, p_title: null, p_content: "GET /eventos\nPOST /inscricoes", p_base_version: 1 });
    expect(first.data).toMatchObject({ ok: true, version: 2 });

    const second = await tool(agentBia, "update_context_block", { block: b.id, content: "GET /eventos\nGET /times", base_version: 1 });
    expect(second.isError).toBe(true);
    expect(second.data).toMatchObject({ ok: false, conflict: true, current: { version: 2, content: "GET /eventos\nPOST /inscricoes" } });
    expect(second.data.message).toMatch(/base_version = 2/);
    expect(await block(b.id)).toMatchObject({ version: 2, content: "GET /eventos\nPOST /inscricoes" });

    // a IA mescla e reenvia contra a versão nova
    const merged = await tool(agentBia, "update_context_block", { block: b.id, content: "GET /eventos\nPOST /inscricoes\nGET /times", base_version: 2 });
    expect(merged.data).toMatchObject({ ok: true, version: 3 });
  });

  it("apagar e desfazer; título repetido é recusado; edição sem mudança não cria versão", async () => {
    const title = uniq("Temporário");
    const b = await create(title, "x");
    expect((await alan.c.rpc("context_create", { p_workspace: ws, p_title: title.toUpperCase(), p_content: "y" })).error?.message).toMatch(/já existe/);
    expect((await alan.c.rpc("context_update", { p_block: b.id, p_title: null, p_content: "x", p_base_version: 1 })).data).toMatchObject({ unchanged: true, version: 1 });

    expect((await bia.c.rpc("context_delete", { p_block: b.id, p_base_version: 1 })).data).toMatchObject({ ok: true, version: 2 });
    const gone = await tool(agentBia, "get_workspace_context", { blocks: [title] });
    expect(gone.data.blocks).toEqual([]);
    expect((await bia.c.rpc("context_restore", { p_block: b.id, p_version: 1, p_base_version: 2 })).data).toMatchObject({ ok: true, version: 3 });
    expect(await block(b.id)).toMatchObject({ deleted_at: null, content: "x" });
  });

  it("ninguém escreve direto na tabela; outro workspace não lê nem edita", async () => {
    const b = await create(uniq("Sigilo"), "segredo do time");
    expect((await alan.c.from("context_blocks").update({ content: "hack" }).eq("id", b.id).select()).data ?? []).toEqual([]);
    expect((await alan.c.from("context_blocks").insert({ workspace_id: ws, title: uniq("direto"), content: "x" })).error).not.toBeNull();

    expect((await intruso.c.from("context_blocks").select("id").eq("id", b.id)).data).toEqual([]);
    expect((await intruso.c.from("context_block_history").select("id").eq("block_id", b.id)).data).toEqual([]);
    expect((await intruso.c.rpc("context_update", { p_block: b.id, p_title: null, p_content: "hack", p_base_version: 1 })).error?.message).toMatch(/não encontrado/);
    const viaAgent = await tool(agentIntruso, "update_context_block", { block: b.id, content: "hack", base_version: 1 });
    expect(viaAgent.isError).toBe(true);
    const list = await tool(agentIntruso, "get_workspace_context");
    expect(JSON.stringify(list.data)).not.toContain("segredo do time");
    expect(await block(b.id)).toMatchObject({ content: "segredo do time", version: 1 });
  });
});
