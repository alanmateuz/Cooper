// Migração 0016: resumo do contexto (substitui o conteúdo, guarda histórico e mede antes/depois).
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { agentToken, asAgent, asUser, createUser, freshDb, one } from "./harness";

let db: PGlite;
let ws: string, tok: string, owner: { id: string; email: string };
const SESSION = "sessao-de-teste-1";
const LONG = "Decisão: usar D1 com Drizzle. ".repeat(40);

beforeEach(async () => {
  db = await freshDb();
  owner = { id: await createUser(db, "dono@example.com", "Dono"), email: "dono@example.com" };
  ws = (await one(db.query<{ id: string }>("insert into public.workspaces (name, created_by) values ('P', $1) returning id", [owner.id]))).id;
  tok = await agentToken(db, ws, owner.id, "claude_code");
  await asUser(db, owner, (tx) => tx.query("select public.context_create($1, 'Arquitetura', $2)", [ws, LONG]));
  await asUser(db, owner, (tx) => tx.query("select public.context_create($1, 'Curto', 'ok')", [ws]));
});

const agent = <T = Record<string, any>>(fn: string, args: unknown[] = []) =>
  asAgent(db, async (tx) => {
    const ph = args.map((_, i) => `$${i + 3}`).join(", ");
    return (await one(tx.query<{ r: T }>(`select public.${fn}($1, $2${ph ? ", " + ph : ""}) as r`, [tok, SESSION, ...args]))).r;
  });

describe("resumo do contexto", () => {
  it("entrega blocos com instrução; grava menor; mede e guarda histórico", async () => {
    const s = await agent("mcp_summarize_context", [null]);
    expect(s.instructions).toMatch(/40%/);
    expect(s.blocks[0]).toMatchObject({ title: "Arquitetura", version: 1, chars: LONG.length });
    // os blocos padrão do projeto (Decisões, Handoffs) também entram na soma
    const padrao = await one(db.query<{ n: number }>(
      "select sum(char_length(content))::int as n from public.context_blocks where workspace_id = $1 and title in ('Decisões', 'Handoffs')", [ws]));
    expect(s.total_chars).toBe(LONG.length + 2 + padrao.n);

    const r = await agent("mcp_save_context_summary", ["Arquitetura", "- D1 + Drizzle", 1]);
    expect(r).toMatchObject({ ok: true, version: 2, chars_before: LONG.length, chars_after: 14 });
    expect(r.reduction_pct).toBeGreaterThan(90);

    const log = await one(db.query<{ chars_before: number; chars_after: number; agent: string }>("select * from public.context_summaries"));
    expect(log).toMatchObject({ chars_before: LONG.length, chars_after: 14, agent: "claude_code" });
    const hist = await one(db.query<{ content: string }>("select content from public.context_block_history where version = 1"));
    expect(hist.content).toBe(LONG); // dá para desfazer
  });

  it("recusa resumo maior e respeita base_version", async () => {
    await expect(agent("mcp_save_context_summary", ["Curto", "texto bem maior que ok", 1])).rejects.toThrow(/menor/);
    const stale = await agent("mcp_save_context_summary", ["Arquitetura", "- D1", 7]);
    expect(stale).toMatchObject({ ok: false, conflict: true });
    expect((await one(db.query<{ n: number }>("select count(*)::int n from public.context_summaries"))).n).toBe(0);
  });
});
