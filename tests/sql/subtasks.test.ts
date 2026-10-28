// Migração 0015: subtarefas (com fechamento automático da mãe), comentários e prioridade/prazo.
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { agentToken, asAgent, asUser, createUser, freshDb, one } from "./harness";

type U = { id: string; email: string };
let db: PGlite;
let mateus: U, ian: U, fora: U;
let ws: string, tokMateus: string, tokIan: string;
const SESSION = "sessao-de-teste-1";

beforeEach(async () => {
  db = await freshDb();
  mateus = { id: await createUser(db, "mateus@example.com", "Mateus"), email: "mateus@example.com" };
  ian = { id: await createUser(db, "ian@example.com", "Ian"), email: "ian@example.com" };
  fora = { id: await createUser(db, "fora@example.com", "Fora"), email: "fora@example.com" };
  ws = (await one(db.query<{ id: string }>("insert into public.workspaces (name, created_by) values ('P', $1) returning id", [mateus.id]))).id;
  await db.query("insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')", [ws, ian.id]);
  tokMateus = await agentToken(db, ws, mateus.id, "claude_code");
  tokIan = await agentToken(db, ws, ian.id, "codex");
});

const agent = <T = Record<string, any>>(tok: string, fn: string, args: unknown[] = []) =>
  asAgent(db, async (tx) => {
    const ph = args.map((_, i) => `$${i + 3}`).join(", ");
    return (await one(tx.query<{ r: T }>(`select public.${fn}($1, $2${ph ? ", " + ph : ""}) as r`, [tok, SESSION, ...args]))).r;
  });
const statusOf = async (n: number) => (await one(db.query<{ status: string }>("select status from public.tasks where workspace_id = $1 and number = $2", [ws, n]))).status;

describe("subtarefas", () => {
  it("dividir uma tarefa; todas concluídas → mãe em revisão", async () => {
    const mae = await agent(tokMateus, "mcp_create_task", ["Página do evento", null, null]);
    await agent(tokMateus, "mcp_start_task", [mae.number, null]);
    const a = await agent(tokMateus, "mcp_create_subtask", [mae.number, "Header", null, null]);
    const b = await agent(tokMateus, "mcp_create_subtask", [mae.number, "Rodapé", null, "Ian"]);
    expect(a).toMatchObject({ parent: mae.number, status: "backlog" });
    expect(b).toMatchObject({ status: "awaiting_acceptance", assignee: "Ian" });

    const disc = await agent(tokIan, "mcp_get_task_discussion", [mae.number]);
    expect(disc.subtasks.map((s: { title: string }) => s.title)).toEqual(["Header", "Rodapé"]);

    await agent(tokMateus, "mcp_start_task", [a.number, null]);
    await agent(tokMateus, "mcp_complete_task", ["ok", a.number, null]);
    expect(await statusOf(mae.number)).toBe("in_progress"); // falta o rodapé

    await agent(tokIan, "mcp_accept_task", [b.number]);
    await agent(tokIan, "mcp_start_task", [b.number, null]);
    await agent(tokIan, "mcp_complete_task", ["ok", b.number, null]);
    expect(await statusOf(mae.number)).toBe("in_review");
  });

  it("um nível só e sem ciclos", async () => {
    const mae = await agent(tokMateus, "mcp_create_task", ["Mãe", null, null]);
    const filha = await agent(tokMateus, "mcp_create_subtask", [mae.number, "Filha", null, null]);
    await expect(agent(tokMateus, "mcp_create_subtask", [filha.number, "Neta", null, null])).rejects.toThrow(/um nível só/);
    const id = (n: number) => db.query<{ id: string }>("select id from public.tasks where workspace_id = $1 and number = $2", [ws, n]);
    const maeId = (await one(id(mae.number))).id;
    await expect(asUser(db, mateus, (tx) => tx.query("update public.tasks set parent_id = id where id = $1", [maeId]))).rejects.toThrow(/dela mesma/);
  });
});

describe("comentários", () => {
  it("pessoa e IA comentam; a IA lê a conversa; quem é de fora não vê", async () => {
    const t = await agent(tokMateus, "mcp_create_task", ["API", null, "Ian"]);
    const tid = (await one(db.query<{ id: string }>("select id from public.tasks where number = $1 and workspace_id = $2", [t.number, ws]))).id;
    await asUser(db, mateus, (tx) =>
      tx.query("insert into public.task_comments (workspace_id, task_id, author_id, body) values ($1, $2, $3, 'O endpoint mudou: use /v2')", [ws, tid, mateus.id]));
    await agent(tokIan, "mcp_add_task_comment", [t.number, "Entendido, ajustei para /v2"]);

    const disc = await agent(tokIan, "mcp_get_task_discussion", [t.number]);
    expect(disc.comments).toEqual([
      expect.objectContaining({ by: "Mateus", source: "user", text: "O endpoint mudou: use /v2" }),
      expect.objectContaining({ by: "Ian", source: "agent_declared", text: "Entendido, ajustei para /v2" }),
    ]);
    const ev = await one(db.query<{ n: number }>("select count(*)::int n from public.task_events where type = 'comment_added'"));
    expect(ev.n).toBe(2);

    const seen = await asUser(db, fora, (tx) => tx.query("select * from public.task_comments"));
    expect(seen.rows).toEqual([]);
    await expect(asUser(db, mateus, (tx) =>
      tx.query("insert into public.task_comments (workspace_id, task_id, author_id, source, body) values ($1, $2, $3, 'agent_declared', 'x')", [ws, tid, mateus.id]))).rejects.toThrow();
  });
});

describe("prioridade e prazo", () => {
  it("qualquer membro planeja; valores fora da faixa são recusados", async () => {
    const t = await agent(tokMateus, "mcp_create_task", ["Deploy", null, "Ian"]);
    const r = await agent(tokIan, "mcp_plan_task", [t.number, 3, "2026-11-05", false]);
    expect(r).toMatchObject({ priority: 3, due_on: "2026-11-05" });
    const cleared = await agent(tokIan, "mcp_plan_task", [t.number, null, null, true]);
    expect(cleared.due_on).toBeUndefined();
    await expect(agent(tokIan, "mcp_plan_task", [t.number, 9, null, false])).rejects.toThrow();
  });
});
