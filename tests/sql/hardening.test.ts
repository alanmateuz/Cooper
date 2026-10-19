// Migração 0012 (segurança, CRUD e MCP compacto), testada num Postgres local (PGlite).
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { agentToken, asAgent, asUser, createUser, freshDb, one } from "./harness";

type U = { id: string; email: string };
let db: PGlite;
let owner: U, member: U, outsider: U;
let ws: string;

const SESSION = "sessao-de-teste-1";

async function setup() {
  db = await freshDb();
  owner = { id: await createUser(db, "dono@example.com", "Dono"), email: "dono@example.com" };
  member = { id: await createUser(db, "membro@example.com", "Membro"), email: "membro@example.com" };
  outsider = { id: await createUser(db, "fora@example.com", "Fora"), email: "fora@example.com" };
  ws = (await one(db.query<{ id: string }>("insert into public.workspaces (name, created_by) values ('Projeto', $1) returning id", [owner.id]))).id;
  await db.query("insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')", [ws, member.id]);
}

/** Tarefa criada pelo dono para o membro, já aceita (backlog). */
async function acceptedTaskForMember(prompt = "faça X") {
  const t = await asUser(db, owner, (tx) =>
    one(tx.query<{ id: string; status: string }>(
      "insert into public.tasks (workspace_id, title, prompt, assignee_id, created_by) values ($1, 'Tarefa', $2, $3, $4) returning id, status",
      [ws, prompt, member.id, owner.id],
    )),
  );
  expect(t.status).toBe("awaiting_acceptance");
  await asUser(db, member, (tx) => tx.query("update public.tasks set status = 'backlog' where id = $1", [t.id]));
  return t.id;
}

const status = async (id: string) => (await one(db.query<{ status: string }>("select status from public.tasks where id = $1", [id]))).status;
const events = async (id: string, type: string) =>
  (await db.query<{ payload: Record<string, unknown> }>("select payload from public.task_events where task_id = $1 and type = $2 order by occurred_at", [id, type])).rows;

beforeEach(setup);

describe("versão do esquema", () => {
  it("cooper_server_info responde para anon", async () => {
    const r = await asAgent(db, (tx) => one(tx.query<{ r: unknown }>("select public.cooper_server_info() as r")));
    expect(r.r).toEqual({ app: "cooper", schema: 12 });
  });
});

describe("edição de tarefas", () => {
  it("responsável que não criou a tarefa não edita título nem prompt", async () => {
    const id = await acceptedTaskForMember();
    await expect(asUser(db, member, (tx) => tx.query("update public.tasks set title = 'outro' where id = $1", [id]))).rejects.toThrow(/só quem criou/);
    await expect(asUser(db, member, (tx) => tx.query("update public.tasks set prompt = 'outro' where id = $1", [id]))).rejects.toThrow(/só quem criou/);
  });

  it("responsável continua mudando o status da própria tarefa", async () => {
    const id = await acceptedTaskForMember();
    await asUser(db, member, (tx) => tx.query("update public.tasks set status = 'in_progress' where id = $1", [id]));
    expect(await status(id)).toBe("in_progress");
  });

  it("mudar o prompt de tarefa aceita por outra pessoa pede novo aceite e gera task_edited", async () => {
    const id = await acceptedTaskForMember();
    await asUser(db, member, (tx) => tx.query("update public.tasks set status = 'in_progress' where id = $1", [id]));
    await asUser(db, owner, (tx) => tx.query("update public.tasks set prompt = 'faça Y' where id = $1", [id]));
    expect(await status(id)).toBe("awaiting_acceptance");
    const ev = await events(id, "task_edited");
    expect(ev.at(-1)!.payload).toEqual({ fields: ["prompt"], reaccept: true });
  });

  it("editar só a descrição não pede novo aceite", async () => {
    const id = await acceptedTaskForMember();
    await asUser(db, owner, (tx) => tx.query("update public.tasks set description = 'mais detalhes' where id = $1", [id]));
    expect(await status(id)).toBe("backlog");
    expect((await events(id, "task_edited")).at(-1)!.payload).toEqual({ fields: ["description"], reaccept: false });
  });

  it("dono do projeto edita tarefa criada por outro membro", async () => {
    const id = (
      await asUser(db, member, (tx) =>
        one(tx.query<{ id: string }>("insert into public.tasks (workspace_id, title, created_by) values ($1, 'Do membro', $2) returning id", [ws, member.id])),
      )
    ).id;
    await asUser(db, owner, (tx) => tx.query("update public.tasks set title = 'Renomeada' where id = $1", [id]));
    expect((await one(db.query<{ title: string }>("select title from public.tasks where id = $1", [id]))).title).toBe("Renomeada");
  });
});

describe("permissões mais estreitas", () => {
  it("conexão de agente: só revogar; nada mais muda e não dá para reativar", async () => {
    await agentToken(db, ws, member.id);
    await expect(asUser(db, member, (tx) => tx.query("update public.agent_connections set label = 'x' where user_id = $1", [member.id]))).rejects.toThrow(
      /permission denied/,
    );
    await asUser(db, member, (tx) => tx.query("update public.agent_connections set revoked_at = now() where user_id = $1", [member.id]));
    await expect(asUser(db, member, (tx) => tx.query("update public.agent_connections set revoked_at = null where user_id = $1", [member.id]))).rejects.toThrow(
      /row-level security/,
    );
  });

  it("pessoa não grava evento nem vínculo como declarado, nem mexe em sessão de agente", async () => {
    const id = await acceptedTaskForMember();
    const ins = (source: string) =>
      asUser(db, member, (tx) =>
        tx.query("insert into public.task_events (workspace_id, task_id, user_id, source, type) values ($1, $2, $3, $4, 'nota')", [ws, id, member.id, source]),
      );
    await expect(ins("agent_declared")).rejects.toThrow(/row-level security/);
    await expect(ins("user")).resolves.toBeTruthy();
    await expect(
      asUser(db, member, (tx) => tx.query("insert into public.task_links (workspace_id, task_id, kind, ref, source) values ($1, $2, 'branch', 'b', 'agent_declared')", [ws, id])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, member, (tx) =>
        tx.query("insert into public.agent_sessions (workspace_id, user_id, agent_kind, client_session_id, has_hooks) values ($1, $2, 'codex', 'forjada-123', true)", [
          ws,
          member.id,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("projetos e membros", () => {
  it("membro sai: perde tokens e uso compartilhado; dono não sai por essa via", async () => {
    await agentToken(db, ws, member.id);
    await db.query("insert into public.ai_usage (workspace_id, user_id, agent_kind, day) values ($1, $2, 'codex', current_date)", [ws, member.id]);
    await asUser(db, member, (tx) => tx.query("delete from public.workspace_members where workspace_id = $1 and user_id = $2", [ws, member.id]));
    const left = await db.query("select 1 from public.workspace_members where workspace_id = $1 and user_id = $2", [ws, member.id]);
    expect(left.rows).toHaveLength(0);
    const tokens = await db.query<{ revoked_at: string | null }>("select revoked_at from public.agent_connections where user_id = $1", [member.id]);
    expect(tokens.rows.every((t) => t.revoked_at !== null)).toBe(true);
    expect((await db.query("select 1 from public.ai_usage where user_id = $1", [member.id])).rows).toHaveLength(0);

    const r = await asUser(db, owner, (tx) => tx.query("delete from public.workspace_members where workspace_id = $1 and user_id = $2", [ws, owner.id]));
    expect(r.affectedRows).toBe(0);
  });

  it("só o dono apaga o projeto, e a cascata não quebra a limpeza", async () => {
    await agentToken(db, ws, member.id);
    await db.query("insert into public.ai_usage (workspace_id, user_id, agent_kind, day) values ($1, $2, 'codex', current_date)", [ws, member.id]);
    await acceptedTaskForMember();
    const byMember = await asUser(db, member, (tx) => tx.query("delete from public.workspaces where id = $1", [ws]));
    expect(byMember.affectedRows).toBe(0);
    const byOutsider = await asUser(db, outsider, (tx) => tx.query("delete from public.workspaces where id = $1", [ws]));
    expect(byOutsider.affectedRows).toBe(0);
    const byOwner = await asUser(db, owner, (tx) => tx.query("delete from public.workspaces where id = $1", [ws]));
    expect(byOwner.affectedRows).toBe(1);
    expect((await db.query("select 1 from public.tasks where workspace_id = $1", [ws])).rows).toHaveLength(0);
  });
});

describe("MCP compacto", () => {
  async function call<T = Record<string, unknown>>(fn: string, args: unknown[]): Promise<T> {
    const ph = args.map((_, i) => `$${i + 1}`).join(", ");
    return (await asAgent(db, (tx) => one(tx.query<{ r: T }>(`select public.${fn}(${ph}) as r`, args)))).r;
  }

  it("get_briefing: tarefas aguardando, minhas e o time, sem chaves vazias", async () => {
    const token = await agentToken(db, ws, member.id);
    await asUser(db, owner, (tx) =>
      tx.query("insert into public.tasks (workspace_id, title, assignee_id, created_by) values ($1, 'Nova', $2, $3)", [ws, member.id, owner.id]),
    );
    const b = await call<Record<string, unknown>>("mcp_get_briefing", [token, SESSION]);
    expect(Object.keys(b).sort()).toEqual(["awaiting_acceptance", "team"]);
    expect(b.awaiting_acceptance).toEqual([{ number: 1, title: "Nova", from: "Dono", has_prompt: false }]);
    expect(b.team).toEqual([{ name: "Dono" }]);
  });

  it("get_task_context: resumo do projeto só quando pedido; sem nulos", async () => {
    const token = await agentToken(db, ws, member.id);
    await acceptedTaskForMember("prompt");
    await db.query("insert into public.context_blocks (workspace_id, title, content) values ($1, 'Resumo', 'O projeto faz Z')", [ws]);
    const plain = await call<Record<string, unknown>>("mcp_get_task_context", [token, SESSION, 1]);
    expect(plain).not.toHaveProperty("project_summary");
    expect(plain).not.toHaveProperty("prompt_note");
    expect(Object.values(plain).some((v) => v === null)).toBe(false);
    const withSummary = await call<Record<string, unknown>>("mcp_get_task_context", [token, SESSION, 1, true]);
    expect(withSummary.project_summary).toMatchObject({ title: "Resumo", content: "O projeto faz Z", truncated: false });
  });

  it("get_workspace_context: listagem sem id, updated_at nem hint", async () => {
    const token = await agentToken(db, ws, member.id);
    await db.query("insert into public.context_blocks (workspace_id, title, content) values ($1, 'Resumo', $2)", [ws, "x".repeat(300)]);
    const r = await call<{ blocks: Record<string, unknown>[] }>("mcp_get_workspace_context", [token, SESSION]);
    expect(Object.keys(r.blocks[0]!).sort()).toEqual(["chars", "preview", "title", "version"]);
    expect((r.blocks[0]!.preview as string).length).toBe(120);
    expect(r).not.toHaveProperty("hint");
  });

  it("patch_context_block: acrescenta, troca trecho único e recusa trecho repetido", async () => {
    const token = await agentToken(db, ws, member.id);
    await db.query("insert into public.context_blocks (workspace_id, title, content) values ($1, 'Convenções', 'a\nb\nb')", [ws]);
    const appended = await call<{ ok: boolean; version: number }>("mcp_patch_context_block", [token, SESSION, "Convenções", "c", null, null]);
    expect(appended).toMatchObject({ ok: true, version: 2 });
    await call("mcp_patch_context_block", [token, SESSION, "Convenções", null, "a", "A"]);
    const content = (await one(db.query<{ content: string }>("select content from public.context_blocks where title = 'Convenções'"))).content;
    expect(content).toBe("A\nb\nb\nc");
    await expect(call("mcp_patch_context_block", [token, SESSION, "Convenções", null, "b", "B"])).rejects.toThrow(/aparece 2 vez/);
    await expect(call("mcp_patch_context_block", [token, SESSION, "Convenções", "x", "a", "b"])).rejects.toThrow(/um dos dois/);
  });

  it("token de outro projeto não vê nada deste", async () => {
    const other = (await one(db.query<{ id: string }>("insert into public.workspaces (name, created_by) values ('Outro', $1) returning id", [outsider.id]))).id;
    const token = await agentToken(db, other, outsider.id);
    await acceptedTaskForMember();
    await expect(call("mcp_get_task_context", [token, SESSION, 1])).rejects.toThrow(/não existe/);
    const b = await call<Record<string, unknown>>("mcp_get_briefing", [token, SESSION]);
    expect(JSON.stringify(b)).not.toMatch(/Dono|Membro/);
  });
});
