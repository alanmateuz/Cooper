// Migração 0017: hooks do Claude Code marcam a sessão MCP aberta como observada ("Executando").
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { agentToken, asAgent, createUser, freshDb, one } from "./harness";

let db: PGlite;
let tok: string;
const SESSION = "sessao-de-teste-1";

beforeEach(async () => {
  db = await freshDb();
  const owner = await createUser(db, "dono@example.com", "Dono");
  const ws = (await one(db.query<{ id: string }>("insert into public.workspaces (name, created_by) values ('P', $1) returning id", [owner]))).id;
  tok = await agentToken(db, ws, owner, "claude_code");
});

const hook = (event: string) =>
  asAgent(db, async (tx) => (await one(tx.query<{ r: { ok: boolean } }>("select public.mcp_hook_event($1, $2) as r", [tok, event]))).r);

describe("hooks", () => {
  it("sem sessão MCP aberta, não cria nada", async () => {
    expect(await hook("pre_tool_use")).toMatchObject({ ok: false });
    expect((await db.query("select 1 from public.agent_sessions")).rows).toHaveLength(0);
  });

  it("marca a sessão aberta com o evento e has_hooks", async () => {
    await asAgent(db, (tx) => tx.query("select public.mcp_get_briefing($1, $2)", [tok, SESSION]));
    expect(await hook("pre_tool_use")).toEqual({ ok: true });
    const s = await one(db.query<{ has_hooks: boolean; last_event_type: string }>("select has_hooks, last_event_type from public.agent_sessions"));
    expect(s).toEqual({ has_hooks: true, last_event_type: "pre_tool_use" });
    await hook("stop");
    expect((await one(db.query<{ t: string }>("select last_event_type as t from public.agent_sessions"))).t).toBe("stop");
  });

  it("recusa evento desconhecido e token inválido", async () => {
    await expect(hook("rm -rf")).rejects.toThrow(/inválido/);
    tok = "coop_invalido";
    await expect(hook("stop")).rejects.toThrow();
  });
});
