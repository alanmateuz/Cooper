// Migração 0018: revisão humana. Com o projeto exigindo, o agente leva a tarefa só até "Em revisão".
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { agentToken, asAgent, asUser, createUser, freshDb, one } from "./harness";

let db: PGlite;
let ws: string, tok: string;
let me: { id: string; email: string };
const SESSION = "sessao-de-teste-1";

beforeEach(async () => {
  db = await freshDb();
  me = { id: await createUser(db, "mateus@example.com", "Mateus"), email: "mateus@example.com" };
  ws = (await one(db.query<{ id: string }>("insert into public.workspaces (name, created_by) values ('P', $1) returning id", [me.id]))).id;
  tok = await agentToken(db, ws, me.id, "claude_code");
});

const agent = <T = Record<string, any>>(fn: string, args: unknown[] = []) =>
  asAgent(db, async (tx) => {
    const ph = args.map((_, i) => `$${i + 3}`).join(", ");
    return (await one(tx.query<{ r: T }>(`select public.${fn}($1, $2${ph ? ", " + ph : ""}) as r`, [tok, SESSION, ...args]))).r;
  });

async function started(): Promise<number> {
  const c = await agent("mcp_create_task", ["Header", "faça o header", null]);
  await agent("mcp_start_task", [c.number, null]);
  return c.number as number;
}
const status = async (n: number) =>
  (await one(db.query<{ s: string }>("select status as s from public.tasks where workspace_id = $1 and number = $2", [ws, n]))).s;

describe("revisão humana", () => {
  it("desligada: o agente conclui", async () => {
    const n = await started();
    expect(await agent("mcp_complete_task", ["feito", n, null])).toMatchObject({ status: "done" });
  });

  it("ligada: o agente só leva até Em revisão; a pessoa conclui", async () => {
    await asUser(db, me, (tx) => tx.query("update public.workspaces set require_human_review = true where id = $1", [ws]));
    const n = await started();
    expect(await agent("mcp_complete_task", ["feito", n, null])).toMatchObject({ status: "in_review" });
    expect(await status(n)).toBe("in_review");
    await asUser(db, me, (tx) => tx.query("update public.tasks set status = 'done' where workspace_id = $1 and number = $2", [ws, n]));
    expect(await status(n)).toBe("done");
  });
});
