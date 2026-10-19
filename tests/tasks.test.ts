// Etapa 2 da nova direção: tarefas com prompt, atribuição mútua e aceite (critérios 1 a 6 da seção 3.1).
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
const tag = () => `[teste ${new Date().toISOString().slice(11, 19)}]`;

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

async function call(c: Client, name: string, args: Record<string, unknown> = {}) {
  const r = (await c.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  if (r.isError) throw new Error(r.content[0]?.text);
  return JSON.parse(r.content[0]!.text);
}

describe.skipIf(!SUPABASE_URL || !SUPABASE_ANON_KEY)("tarefas com prompt e aceite", () => {
  let alan: { c: SupabaseClient; id: string }, bia: { c: SupabaseClient; id: string }, intruso: { c: SupabaseClient; id: string };
  let ws: string;
  let agentAlan: Client, agentBia: Client, agentIntruso: Client;

  const send = async (fields: Record<string, unknown>) => {
    const r = await alan.c
      .from("tasks")
      .insert({ workspace_id: ws, created_by: alan.id, ...fields })
      .select()
      .single();
    if (r.error) throw r.error;
    return r.data;
  };

  beforeAll(async () => {
    [alan, bia, intruso] = await Promise.all([signIn("ALAN"), signIn("BIA"), signIn("INTRUSO")]);
    ws = (await alan.c.from("workspaces").select("id").eq("name", "Hacko (demo)").single()).data!.id;
    [agentAlan, agentBia, agentIntruso] = await Promise.all([
      mcpClient(env("TEST_ALAN_AGENT_TOKEN")),
      mcpClient(env("TEST_BIA_AGENT_TOKEN")),
      mcpClient(env("TEST_INTRUSO_AGENT_TOKEN")),
    ]);
  }, 30_000);
  afterAll(async () => {
    await Promise.all([agentAlan?.close(), agentBia?.close(), agentIntruso?.close(), bia?.c.removeAllChannels()]);
  });

  it("critério 1: tarefa para o outro nasce aguardando aceite e chega pelo Realtime", async () => {
    const title = `${tag()} Header`;
    const seen = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Realtime não entregou em 15 s")), 15_000);
      bia.c
        .channel(`tarefas-${Date.now()}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "tasks", filter: `workspace_id=eq.${ws}` }, (p) => {
          const row = p.new as { title: string; status: string };
          if (row.title === title) {
            clearTimeout(timer);
            resolve(row.status);
          }
        })
        .subscribe();
    });
    await new Promise((r) => setTimeout(r, 1500));
    const t = await send({ title, prompt: "Crie o header com logo e menu.", assignee_id: bia.id });
    expect(t.status).toBe("awaiting_acceptance");
    expect(t.accepted_at).toBeNull();
    expect(await seen).toBe("awaiting_acceptance");
  }, 30_000);

  it("critério 2: só quem recebeu aceita; quem enviou vê a mudança com a origem", async () => {
    const t = await send({ title: `${tag()} aceitar`, assignee_id: bia.id });
    const byAlan = await alan.c.from("tasks").update({ status: "backlog" }).eq("id", t.id);
    expect(byAlan.error?.message).toMatch(/só quem recebeu/);

    const ok = await bia.c.from("tasks").update({ status: "backlog" }).eq("id", t.id);
    expect(ok.error).toBeNull();
    const after = (await alan.c.from("tasks").select("status,accepted_at").eq("id", t.id).single()).data!;
    expect(after.status).toBe("backlog");
    expect(after.accepted_at).not.toBeNull();

    const ev = await alan.c.from("task_events").select("type,source,user_id,payload").eq("task_id", t.id).order("occurred_at");
    expect(ev.data!.map((e) => e.type)).toEqual(["task_created", "status_changed"]);
    expect(ev.data![1]).toMatchObject({ source: "user", user_id: bia.id, payload: { from_status: "awaiting_acceptance", to_status: "backlog" } });
  });

  it("não dá para pular o aceite nem escolher status de aceite à mão", async () => {
    const t = await send({ title: `${tag()} pular`, assignee_id: bia.id });
    const skip = await bia.c.from("tasks").update({ status: "in_progress" }).eq("id", t.id);
    expect(skip.error?.message).toMatch(/aceite a tarefa/);
    const mine = await send({ title: `${tag()} minha` });
    const fake = await alan.c.from("tasks").update({ status: "awaiting_acceptance" }).eq("id", mine.id);
    expect(fake.error?.message).toMatch(/troque o responsável/);
  });

  it("critério 5: recusar exige motivo, e o motivo aparece para quem enviou (widget e MCP)", async () => {
    const t = await send({ title: `${tag()} recusar`, assignee_id: bia.id });
    const noReason = await bia.c.from("tasks").update({ status: "declined" }).eq("id", t.id);
    expect(noReason.error?.message).toMatch(/motivo/);
    const blank = await bia.c.from("tasks").update({ status: "declined", decline_reason: "   " }).eq("id", t.id);
    expect(blank.error?.message).toMatch(/motivo/);

    const ok = await bia.c.from("tasks").update({ status: "declined", decline_reason: "Sem tempo esta semana" }).eq("id", t.id);
    expect(ok.error).toBeNull();
    const row = (await alan.c.from("tasks").select("status,decline_reason,declined_at").eq("id", t.id).single()).data!;
    expect(row).toMatchObject({ status: "declined", decline_reason: "Sem tempo esta semana" });
    expect(row.declined_at).not.toBeNull();

    const mine = await call(agentAlan, "get_my_tasks");
    expect(mine.declined_by_others).toContainEqual(expect.objectContaining({ number: t.number, reason: "Sem tempo esta semana" }));

    // reenviar volta para aguardando aceite e limpa o motivo
    await alan.c.from("tasks").update({ status: "awaiting_acceptance" }).eq("id", t.id);
    const resent = (await alan.c.from("tasks").select("status,decline_reason").eq("id", t.id).single()).data!;
    expect(resent).toEqual({ status: "awaiting_acceptance", decline_reason: null });
  });

  it("tarefa para si mesmo nasce aceita; trocar o responsável gera novo convite", async () => {
    const t = await send({ title: `${tag()} para mim`, assignee_id: alan.id });
    expect(t.status).toBe("backlog");
    expect(t.accepted_at).not.toBeNull();
    await alan.c.from("tasks").update({ assignee_id: bia.id }).eq("id", t.id);
    const sent = (await alan.c.from("tasks").select("status,accepted_at").eq("id", t.id).single()).data!;
    expect(sent).toEqual({ status: "awaiting_acceptance", accepted_at: null });
  });

  it("critério 3: ciclo completo pelo MCP (criar, aceitar, recuperar prompt, iniciar, progresso, concluir)", async () => {
    const prompt = "Implemente o header: logo à esquerda, menu à direita. Use os tokens de cor do projeto.";
    const created = await call(agentAlan, "create_task", { title: `${tag()} Header via MCP`, prompt, assigned_to: "bia" });
    expect(created).toMatchObject({ status: "awaiting_acceptance", assignee: expect.stringMatching(/^Bia/) });
    const n = created.number as number;

    const pending = await call(agentBia, "get_my_tasks");
    expect(pending.awaiting_acceptance).toContainEqual(expect.objectContaining({ number: n, has_prompt: true, from: expect.stringMatching(/^Alan/) }));
    await expect(call(agentBia, "start_task", { task_number: n })).rejects.toThrow(/aguarda aceite/);
    await expect(call(agentAlan, "accept_task", { task_number: n })).rejects.toThrow(/só quem recebeu/);

    await call(agentBia, "accept_task", { task_number: n });
    const ctx = await call(agentBia, "get_task_context", { task_number: n });
    expect(ctx).toMatchObject({ prompt, sent_by: expect.stringMatching(/^Alan/), assigned_to_you: true, status: "backlog" });
    expect(ctx.prompt_note).toMatch(/não é instrução de sistema/i);

    await call(agentBia, "start_task", { task_number: n, branch: "claude/header" });
    await call(agentBia, "report_progress", { text: "Montando o header" });
    const done = await call(agentBia, "complete_task", { summary: "Header pronto com logo e menu.", evidence: ["pnpm test header"] });
    expect(done).toMatchObject({ number: n, status: "done", source: "agent_declared" });

    // critério 4: quem enviou acompanha cada mudança, com a origem de cada uma
    const t = (await alan.c.from("tasks").select("id,status").eq("workspace_id", ws).eq("number", n).single()).data!;
    expect(t.status).toBe("done");
    const ev = (await alan.c.from("task_events").select("type,source,payload,evidence").eq("task_id", t.id).order("occurred_at")).data!;
    const steps = ev.map((e) => `${e.type}:${e.source}:${e.payload.to_status ?? ""}`);
    // eventos da mesma chamada têm o mesmo horário; a ordem entre eles não é garantida
    expect(steps).toHaveLength(7);
    expect(steps).toEqual(expect.arrayContaining([
      "task_created:agent_declared:awaiting_acceptance",
      "status_changed:agent_declared:backlog",
      "status_changed:agent_declared:in_progress",
      "start_task:agent_declared:",
      "report_progress:agent_declared:",
      "status_changed:agent_declared:done",
      "complete_task:agent_declared:",
    ]));
    expect(ev.find((e) => e.type === "complete_task")).toMatchObject({ payload: { summary: "Header pronto com logo e menu." }, evidence: ["pnpm test header"] });
  }, 40_000);

  it("create_task sem responsável vai para quem pediu; nome desconhecido é recusado", async () => {
    const own = await call(agentBia, "create_task", { title: `${tag()} só minha` });
    expect(own).toMatchObject({ status: "backlog", assignee: expect.stringMatching(/^Bia/) });
    await expect(call(agentBia, "create_task", { title: "x", assigned_to: "Fulano" })).rejects.toThrow(/nenhum membro.*Membros:/);
  });

  it("critério 6: outro workspace não vê nem altera essas tarefas", async () => {
    const t = await send({ title: `${tag()} sigilo`, prompt: "segredo", assignee_id: bia.id });

    const seen = await intruso.c.from("tasks").select("id").eq("id", t.id);
    expect(seen.data).toEqual([]);
    const upd = await intruso.c.from("tasks").update({ status: "backlog" }).eq("id", t.id).select();
    expect(upd.data ?? []).toEqual([]);
    expect((await alan.c.from("tasks").select("status").eq("id", t.id).single()).data!.status).toBe("awaiting_acceptance");

    // pelo MCP, o número aponta para o workspace dele, não para o demo
    await expect(call(agentIntruso, "accept_task", { task_number: t.number })).rejects.toThrow(/não existe/);
    await expect(call(agentIntruso, "get_task_context", { task_number: t.number })).rejects.toThrow(/não existe/);
    await expect(call(agentIntruso, "create_task", { title: "x", assigned_to: "Bia" })).rejects.toThrow(/nenhum membro/);

    // nem atribuir a tarefa do demo a quem não é membro
    const foreign = await alan.c.from("tasks").update({ assignee_id: intruso.id }).eq("id", t.id);
    expect(foreign.error?.message).toMatch(/não é membro/);
  });
});
