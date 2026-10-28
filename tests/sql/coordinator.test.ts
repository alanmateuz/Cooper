// Migração 0013: modo coordenador da IA, aceite automático e trava de iniciar/concluir tarefa de outra pessoa.
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { agentToken, asAgent, asUser, createUser, freshDb, one } from "./harness";

type U = { id: string; email: string };
let db: PGlite;
let mateus: U, ian: U;
let ws: string;
let tokMateus: string, tokIan: string;
const SESSION = "sessao-de-teste-1";

beforeEach(async () => {
  db = await freshDb();
  mateus = { id: await createUser(db, "mateus@example.com", "Mateus"), email: "mateus@example.com" };
  ian = { id: await createUser(db, "ian@example.com", "Ian"), email: "ian@example.com" };
  ws = (await one(db.query<{ id: string }>("insert into public.workspaces (name, created_by) values ('Projeto', $1) returning id", [mateus.id]))).id;
  await db.query("insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')", [ws, ian.id]);
  tokMateus = await agentToken(db, ws, mateus.id, "claude_code");
  tokIan = await agentToken(db, ws, ian.id, "codex");
});

const setOption = (u: U, opt: string, on: boolean) =>
  asUser(db, u, (tx) => tx.query("select public.set_member_option($1, $2, $3)", [ws, opt, on]));
const agent = <T = Record<string, any>>(tok: string, fn: string, args: unknown[] = []) =>
  asAgent(db, async (tx) => {
    const ph = args.map((_, i) => `$${i + 3}`).join(", ");
    const r = await one(tx.query<{ r: T }>(`select public.${fn}($1, $2${ph ? ", " + ph : ""}) as r`, [tok, SESSION, ...args]));
    return r.r;
  });
const task = async (n: number) =>
  one(db.query<{ status: string; assignee_id: string; title: string; prompt: string | null }>(
    "select status, assignee_id, title, prompt from public.tasks where workspace_id = $1 and number = $2", [ws, n]));

/** Tarefa do Ian, já aceita por ele. */
async function ianTask(): Promise<number> {
  const c = await agent(tokMateus, "mcp_create_task", ["Header", "faça o header", "Ian"]);
  await agent(tokIan, "mcp_accept_task", [c.number]);
  return c.number as number;
}

describe("trava (modo coordenador desligado)", () => {
  it("a IA não inicia nem conclui tarefa de outra pessoa", async () => {
    const n = await ianTask();
    await expect(agent(tokMateus, "mcp_start_task", [n, null])).rejects.toThrow(/é de Ian/);
    await expect(agent(tokMateus, "mcp_complete_task", ["feito", n, null])).rejects.toThrow(/é de Ian/);
    expect((await task(n)).status).toBe("backlog");
  });

  it("a dona da tarefa continua iniciando e concluindo", async () => {
    const n = await ianTask();
    await agent(tokIan, "mcp_start_task", [n, null]);
    await agent(tokIan, "mcp_complete_task", ["feito", n, null]);
    expect((await task(n)).status).toBe("done");
  });

  it("carga do time, redistribuir e editar tarefa alheia pedem o modo coordenador", async () => {
    const n = await ianTask();
    await expect(agent(tokMateus, "mcp_get_team_workload")).rejects.toThrow(/modo coordenador desligado/);
    await expect(agent(tokMateus, "mcp_assign_task", [n, "Mateus"])).rejects.toThrow(/modo coordenador desligado/);
    await expect(agent(tokIan, "mcp_update_task", [n, "Outro título", null, null, null])).rejects.toThrow(/modo coordenador/);
  });
});

describe("modo coordenador ligado", () => {
  beforeEach(() => setOption(mateus, "ai_coordinator", true));

  it("vê a carga do time; uso de IA só de quem compartilha", async () => {
    await ianTask();
    await db.query(
      `insert into public.ai_usage (workspace_id, user_id, agent_kind, day, primary_used_pct, primary_window_minutes, primary_resets_at, secondary_used_pct, secondary_resets_at)
       values ($1, $2, 'codex', current_date, 82, 300, now() + interval '2 hours', 18, now() + interval '3 days')`, [ws, ian.id]);

    let w = await agent<any[]>(tokMateus, "mcp_get_team_workload");
    const ianRow = () => w.find((p) => p.name === "Ian");
    expect(w[0]).toMatchObject({ name: "Mateus", you: true });
    expect(ianRow()).toMatchObject({ open: { backlog: 1 }, tasks: [{ title: "Header", status: "backlog" }], ai_usage: "não compartilhado" });

    await db.query("update public.workspace_members set share_usage = true where workspace_id = $1 and user_id = $2", [ws, ian.id]);
    w = await agent<any[]>(tokMateus, "mcp_get_team_workload");
    expect(ianRow().ai_usage).toEqual([expect.objectContaining({ agent: "codex", five_hour_pct: 82, week_pct: 18 })]);
  });

  it("inicia, conclui, edita e redistribui tarefa de outra pessoa; quem recebe ainda aceita", async () => {
    const n = await ianTask();
    const upd = await agent(tokMateus, "mcp_update_task", [n, "Header responsivo", "novo prompt", null, null]);
    expect(upd).toMatchObject({ ok: true, status: "awaiting_acceptance", reaccept: true }); // prompt novo: Ian aceita de novo
    await agent(tokIan, "mcp_accept_task", [n]);

    const back = await agent(tokMateus, "mcp_assign_task", [n, "mateus"]);
    expect(back).toMatchObject({ assignee: "Mateus", status: "backlog", auto_accepted: false });
    const again = await agent(tokMateus, "mcp_assign_task", [n, "Ian"]);
    expect(again).toMatchObject({ assignee: "Ian", status: "awaiting_acceptance", auto_accepted: false });
    await expect(agent(tokMateus, "mcp_accept_task", [n])).rejects.toThrow(/só quem recebeu/); // não aceita por ela
    await agent(tokIan, "mcp_accept_task", [n]);

    await agent(tokMateus, "mcp_start_task", [n, null]);
    await agent(tokMateus, "mcp_complete_task", ["pronto", n, null]);
    expect(await task(n)).toMatchObject({ status: "done", assignee_id: ian.id, title: "Header responsivo" });
  });
});

describe("aceite automático (de quem recebe)", () => {
  beforeEach(() => setOption(ian, "auto_accept", true));

  it("tarefa enviada já entra aceita, com evento de envio marcado", async () => {
    const c = await agent(tokMateus, "mcp_create_task", ["Footer", "faça o footer", "Ian"]);
    expect(c.status).toBe("backlog");
    const ev = await one(db.query<{ payload: Record<string, unknown> }>(
      "select payload from public.task_events where type = 'task_created' order by occurred_at desc limit 1"));
    expect(ev.payload).toMatchObject({ to_status: "backlog", auto_accepted: true });
  });

  it("vale ao trocar o responsável e ao mudar o prompt", async () => {
    const mine = await asUser(db, mateus, (tx) =>
      one(tx.query<{ id: string }>("insert into public.tasks (workspace_id, title, prompt, assignee_id, created_by) values ($1, 'X', 'p', $2, $2) returning id", [ws, mateus.id])));
    await asUser(db, mateus, (tx) => tx.query("update public.tasks set assignee_id = $1 where id = $2", [ian.id, mine.id]));
    expect((await one(db.query<{ status: string }>("select status from public.tasks where id = $1", [mine.id]))).status).toBe("backlog");
    const sent = await one(db.query<{ payload: Record<string, unknown> }>("select payload from public.task_events where task_id = $1 and type = 'task_sent'", [mine.id]));
    expect(sent.payload).toMatchObject({ auto_accepted: true });

    await asUser(db, mateus, (tx) => tx.query("update public.tasks set prompt = 'outro' where id = $1", [mine.id]));
    expect((await one(db.query<{ status: string }>("select status from public.tasks where id = $1", [mine.id]))).status).toBe("backlog");
  });

  it("sem a chave, continua pedindo aceite", async () => {
    await setOption(ian, "auto_accept", false);
    const c = await agent(tokMateus, "mcp_create_task", ["Footer", null, "Ian"]);
    expect(c.status).toBe("awaiting_acceptance");
  });

  it("cada um só mexe nas próprias chaves", async () => {
    await expect(asAgent(db, (tx) => tx.query("select public.set_member_option($1, 'ai_coordinator', true)", [ws]))).rejects.toThrow();
    const flags = await one(db.query<{ ai_coordinator: boolean }>("select ai_coordinator from public.workspace_members where workspace_id = $1 and user_id = $2", [ws, mateus.id]));
    expect(flags.ai_coordinator).toBe(false);
  });
});
