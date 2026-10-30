// Migração 0020: o app entrega PRs e acesso do GitHub; viram vínculos, eventos e aparecem para os agentes.
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { agentToken, asAgent, asUser, createUser, freshDb, one } from "./harness";

type U = { id: string; email: string };
let db: PGlite;
let alan: U, ian: U;
let ws: string;
let tokAlan: string, tokIan: string;
const SESSION = "sessao-de-teste-1";

beforeEach(async () => {
  db = await freshDb();
  alan = { id: await createUser(db, "alan@example.com", "Alan"), email: "alan@example.com" };
  ian = { id: await createUser(db, "ian@example.com", "Ian"), email: "ian@example.com" };
  ws = (await one(db.query<{ id: string }>("insert into public.workspaces (name, created_by) values ('Quiz', $1) returning id", [alan.id]))).id;
  await db.query("insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')", [ws, ian.id]);
  await db.query("insert into public.repositories (workspace_id, owner, name) values ($1, 'alanmateuz', 'Projeto-exemplo')", [ws]);
  tokAlan = await agentToken(db, ws, alan.id, "claude_code");
  tokIan = await agentToken(db, ws, ian.id, "codex");
});

const agent = <T = Record<string, any>>(tok: string, fn: string, args: unknown[] = []) =>
  asAgent(db, async (tx) => {
    const ph = args.map((_, i) => `$${i + 3}`).join(", ");
    const r = await one(tx.query<{ r: T }>(`select public.${fn}($1, $2${ph ? ", " + ph : ""}) as r`, [tok, SESSION, ...args]));
    return r.r;
  });
const sync = (u: U, prs: object[], access: string | null = null) =>
  asUser(db, u, (tx) => tx.query("select public.github_sync($1, $2::jsonb, $3) as r", [ws, JSON.stringify(prs), access]));

let minute = 0;
const pr = (over: Record<string, unknown> = {}) => ({
  number: 1,
  title: "Integração do quiz",
  state: "open",
  draft: false,
  head_branch: "integracao",
  base_branch: "main",
  head_sha: "7078b6d89b739839dfc4abace85aca623f856d7e",
  author: "alanmateuz",
  checks: "pending",
  review: "pending",
  url: "https://github.com/alanmateuz/Projeto-exemplo/pull/1",
  updated_at: new Date(Date.UTC(2026, 9, 30, 12, minute++)).toISOString(),
  ...over,
});
const prEvents = async () =>
  (await db.query<{ payload: { change: string; pr: number } }>(
    "select payload from public.task_events where type = 'pr_update' order by occurred_at, id")).rows.map((r) => r.payload.change);

/** Tarefa do Alan começada na branch integracao. */
async function taskOnBranch(): Promise<number> {
  const t = await agent(tokAlan, "mcp_create_task", ["Integrar", null, null]);
  await agent(tokAlan, "mcp_start_task", [t.number, "integracao"]);
  return t.number as number;
}

describe("github_sync", () => {
  it("liga o PR à tarefa da branch e registra só as mudanças que importam", async () => {
    const n = await taskOnBranch();
    await sync(alan, [pr()]);
    await sync(alan, [pr()]); // nada mudou
    await sync(alan, [pr({ checks: "failure" })]);
    await sync(alan, [pr({ checks: "success" })]);
    await sync(alan, [pr({ checks: "success", review: "approved" })]);
    await sync(alan, [pr({ state: "merged", checks: "success", review: "approved" })]);
    expect(await prEvents()).toEqual(["opened", "checks_failure", "checks_success", "approved", "merged"]);

    const links = await db.query<{ kind: string; ref: string; url: string; source: string }>(
      "select kind, ref, url, source from public.task_links where kind = 'pr'");
    expect(links.rows).toEqual([{ kind: "pr", ref: "#1", url: "https://github.com/alanmateuz/Projeto-exemplo/pull/1", source: "github" }]);

    const ctx = await agent(tokAlan, "mcp_get_task_context", [n, false]);
    expect(ctx.pull_requests).toEqual(["#1 integracao → main · merge feito · CI ok · aprovado · https://github.com/alanmateuz/Projeto-exemplo/pull/1"]);
    expect(ctx.links).toEqual(["branch: integracao"]);
  });

  it("leitura mais velha que a gravada não volta o estado", async () => {
    await taskOnBranch();
    const fresh = pr({ checks: "success" });
    await sync(alan, [fresh]);
    await sync(ian, [{ ...fresh, checks: "failure", updated_at: "2026-10-30T11:00:00Z" }]);
    const r = await one(db.query<{ checks: string }>("select checks from public.github_pull_requests"));
    expect(r.checks).toBe("success");
  });

  it("só membros entregam, e só PRs válidos", async () => {
    const outsider = { id: await createUser(db, "x@example.com", "X"), email: "x@example.com" };
    await expect(sync(outsider, [pr()])).rejects.toThrow(/não é membro/);
    await expect(sync(alan, [pr({ url: "https://evil.example/pull/1" })])).rejects.toThrow(/github_pull_requests_url_check/);
    await expect(sync(alan, [], "admin")).rejects.toThrow(/write, read ou none/);
    await expect(asAgent(db, (tx) => tx.query("select public.github_sync($1, '[]'::jsonb, null)", [ws]))).rejects.toThrow();
  });
});

describe("agentes", () => {
  it("briefing: PRs abertos, eventos do GitHub e quem não tem acesso de escrita", async () => {
    await taskOnBranch();
    await agent(tokAlan, "mcp_get_briefing");
    await sync(ian, [pr({ checks: "failure" })], "read");
    await sync(alan, [], "write");

    const b = await agent(tokAlan, "mcp_get_briefing");
    expect(b.pull_requests).toEqual(["#1 integracao → main · CI falhou · revisão pendente"]);
    expect(b.since_last.join("\n")).toMatch(/GitHub PR #1 \(#\d+ Integrar\): aberto/);
    expect(b.team.find((p: any) => p.name === "Ian").repo_access).toBe("só leitura (não consegue push)");
    expect(b).not.toHaveProperty("your_repo_access");
    expect((await agent(tokIan, "mcp_get_briefing")).your_repo_access).toBe("só leitura: push vai falhar");
  });
});
