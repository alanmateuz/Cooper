// Migração 0019: dependências com aviso, briefing com novidades, bloqueio, handoff, limite e disponibilidade.
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
  tokAlan = await agentToken(db, ws, alan.id, "claude_code");
  tokIan = await agentToken(db, ws, ian.id, "codex");
});

const agent = <T = Record<string, any>>(tok: string, fn: string, args: unknown[] = []) =>
  asAgent(db, async (tx) => {
    const ph = args.map((_, i) => `$${i + 3}`).join(", ");
    const r = await one(tx.query<{ r: T }>(`select public.${fn}($1, $2${ph ? ", " + ph : ""}) as r`, [tok, SESSION, ...args]));
    return r.r;
  });
const task = async (n: number) =>
  one(db.query<{ status: string; assignee_id: string; blocked_reason: string | null }>(
    "select status, assignee_id, blocked_reason from public.tasks where workspace_id = $1 and number = $2", [ws, n]));

/** Tarefa do Ian, aceita e começada por ele. */
async function ianWorking(title: string, deps: number[] | null = null): Promise<number> {
  const c = await agent(tokAlan, "mcp_create_task", [title, "faça", "Ian", deps]);
  await agent(tokIan, "mcp_accept_task", [c.number]);
  await agent(tokIan, "mcp_start_task", [c.number, null]);
  return c.number as number;
}

describe("dependências", () => {
  it("create_task registra depends_on e devolve o que ainda falta", async () => {
    const banco = await ianWorking("Banco");
    const ui = await agent(tokAlan, "mcp_create_task", ["Integrar", null, null, [banco]]);
    expect(ui.waiting_on).toEqual([`#${banco} Banco`]);
    const ctx = await agent(tokAlan, "mcp_get_task_context", [ui.number, false]);
    expect(ctx.depends_on).toEqual([`#${banco} Banco (in_progress)`]);
    expect((await agent(tokIan, "mcp_get_task_context", [banco, false])).needed_by).toEqual([`#${ui.number} Integrar (backlog)`]);
  });

  it("recusa número inexistente e dependência circular", async () => {
    const a = await agent(tokAlan, "mcp_create_task", ["A", null, null]);
    await expect(agent(tokAlan, "mcp_create_task", ["B", null, null, [99]])).rejects.toThrow(/não encontrada\(s\): 99/);
    const b = await agent(tokAlan, "mcp_create_task", ["B", null, null, [a.number]]);
    await expect(agent(tokAlan, "mcp_set_dependencies", [a.number, [b.number]])).rejects.toThrow(/circular/);
    await expect(agent(tokAlan, "mcp_set_dependencies", [a.number, [a.number]])).rejects.toThrow(/dela mesma/);
    expect((await agent(tokAlan, "mcp_set_dependencies", [b.number, []])).depends_on).toBeUndefined();
  });

  it("concluir a dependência avisa quem esperava, no briefing dele", async () => {
    const banco = await ianWorking("Banco");
    const rev = await ianWorking("Revisão");
    const integrar = await agent(tokAlan, "mcp_create_task", ["Integrar", null, null, [banco, rev]]);
    await agent(tokAlan, "mcp_get_briefing"); // zera as novidades

    await agent(tokIan, "mcp_complete_task", ["banco pronto", banco, ["commit abc1234"]]);
    let b = await agent(tokAlan, "mcp_get_briefing");
    expect(b.since_last.join("\n")).toMatch(new RegExp(`Ian concluiu #${banco}; #${integrar.number} Integrar ainda espera outras`));
    expect(b.tasks.find((t: any) => t.number === integrar.number).waiting_on).toEqual([`#${rev} Revisão`]);

    await agent(tokIan, "mcp_complete_task", ["revisado", rev, null]);
    b = await agent(tokAlan, "mcp_get_briefing");
    expect(b.since_last.join("\n")).toMatch(new RegExp(`#${integrar.number} Integrar está liberada`));
    expect(b.tasks.find((t: any) => t.number === integrar.number).waiting_on).toBeUndefined();
  });
});

describe("briefing com novidades", () => {
  it("mostra só o que mudou desde o último briefing, só dos outros", async () => {
    await agent(tokAlan, "mcp_get_briefing");
    const n = await ianWorking("Banco");
    await agent(tokIan, "mcp_report_progress", ["LIBERA #2: sample.json no GitHub", n, null, null]);
    await agent(tokIan, "mcp_report_progress", ["escrevendo perguntas", n, null, null]);
    await agent(tokAlan, "mcp_report_progress", ["BLOQUEADO: isto é meu", null, null, null]).catch(() => null);

    const b = await agent(tokAlan, "mcp_get_briefing");
    const lines = b.since_last.join("\n");
    expect(lines).toMatch(/Ian aceitou #\d+ Banco/);
    expect(lines).toMatch(/Ian #\d+: LIBERA #2: sample.json no GitHub/);
    expect(lines).not.toMatch(/escrevendo perguntas/);
    expect(lines).not.toMatch(/isto é meu/);

    expect((await agent(tokAlan, "mcp_get_briefing")).since_last).toBeUndefined();
  });

  it("recusa e comentário nas minhas tarefas aparecem", async () => {
    await agent(tokAlan, "mcp_get_briefing");
    const c = await agent(tokAlan, "mcp_create_task", ["Header", "faça", "Ian"]);
    await agent(tokIan, "mcp_decline_task", [c.number, "acima do limite"]);
    const d = await agent(tokAlan, "mcp_create_task", ["Footer", null, null]);
    await agent(tokIan, "mcp_add_task_comment", [d.number, "achei 2 bugs no timer"]);
    const lines = (await agent(tokAlan, "mcp_get_briefing")).since_last.join("\n");
    expect(lines).toMatch(/Ian recusou #\d+ Header: acima do limite/);
    expect(lines).toMatch(/Ian comentou em #\d+ Footer: achei 2 bugs no timer/);
  });
});

describe("bloqueio", () => {
  it("dono marca e desmarca; aparece no briefing do time e no contexto", async () => {
    const n = await ianWorking("Banco");
    await agent(tokAlan, "mcp_get_briefing");
    await expect(agent(tokAlan, "mcp_set_blocked", [n, "não é seu"])).rejects.toThrow(/é de Ian/);
    await agent(tokIan, "mcp_set_blocked", [n, "push negado (403)"]);
    expect((await task(n)).blocked_reason).toBe("push negado (403)");

    const b = await agent(tokAlan, "mcp_get_briefing");
    expect(b.team[0].blocked).toEqual([`#${n}: push negado (403)`]);
    expect(b.since_last.join("\n")).toMatch(/Ian bloqueou #\d+ Banco: push negado/);
    expect((await agent(tokIan, "mcp_get_task_context", [n, false])).blocked).toBe("push negado (403)");

    await agent(tokIan, "mcp_set_blocked", [n, null]);
    expect((await task(n)).blocked_reason).toBeNull();
    expect((await agent(tokAlan, "mcp_get_briefing")).since_last).toEqual([expect.stringMatching(/Ian desbloqueou/)]);
  });
});

describe("conclusão no contexto da tarefa", () => {
  it("traz resumo, evidências e quem concluiu", async () => {
    const n = await ianWorking("Revisão");
    await agent(tokIan, "mcp_complete_task", ["2 achados: atalhos e foco", n, ["ver bloco Decisões"]]);
    const ctx = await agent(tokAlan, "mcp_get_task_context", [n, false]);
    expect(ctx.completion).toMatchObject({ by: "Ian", summary: "2 achados: atalhos e foco", evidence: ["ver bloco Decisões"] });
  });
});

describe("handoff", () => {
  it("quem tem a tarefa passa para outra pessoa, com nota visível na discussão", async () => {
    const n = await ianWorking("Banco");
    await agent(tokIan, "mcp_set_blocked", [n, "sem cota"]);
    const r = await agent(tokIan, "mcp_handoff_task", [n, "Alan", "Branch ian/banco @abc. Falta: 10 perguntas de cultura."]);
    expect(r).toMatchObject({ ok: true, assignee: "Alan", status: "awaiting_acceptance" });
    const t = await task(n);
    expect(t.assignee_id).toBe(alan.id);
    expect(t.blocked_reason).toBeNull();
    const disc = await agent(tokAlan, "mcp_get_task_discussion", [n]);
    expect(JSON.stringify(disc)).toMatch(/Handoff: Branch ian\/banco/);
    expect((await agent(tokAlan, "mcp_get_briefing")).awaiting_acceptance).toEqual([expect.objectContaining({ number: n })]);
  });

  it("terceiros não passam tarefa alheia; nota é obrigatória", async () => {
    const bia = await createUser(db, "bia@example.com", "Bia");
    await db.query("insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')", [ws, bia]);
    const tokBia = await agentToken(db, ws, bia, "other");
    const n = await ianWorking("Banco");
    await expect(agent(tokBia, "mcp_handoff_task", [n, "Bia", "quero"])).rejects.toThrow(/só quem tem a tarefa/);
    await expect(agent(tokIan, "mcp_handoff_task", [n, "Alan", "  "])).rejects.toThrow(/nota do handoff/);
    await expect(agent(tokIan, "mcp_handoff_task", [n, "Ian", "eu mesmo"])).rejects.toThrow(/já é dessa pessoa/);
  });
});

describe("limite e disponibilidade", () => {
  it("avisa ao passar do limite de tarefas abertas do projeto", async () => {
    await asUser(db, alan, (tx) => tx.query("select public.set_wip_limit($1, 2)", [ws]));
    await expect(asUser(db, ian, (tx) => tx.query("select public.set_wip_limit($1, 5)", [ws]))).rejects.toThrow(/só o dono/);
    await ianWorking("A");
    await ianWorking("B");
    const c = await agent(tokAlan, "mcp_create_task", ["C", null, "Ian"]);
    expect(c.warning).toBe("Ian tem 3 tarefas abertas (limite do projeto: 2)");
    expect((await agent(tokIan, "mcp_get_briefing")).over_limit).toMatch(/limite do projeto: 2/);
  });

  it("disponibilidade aparece no briefing de quem é do time", async () => {
    await agent(tokIan, "mcp_set_availability", ["near_limit", "cota acaba em 20 min"]);
    const b = await agent(tokAlan, "mcp_get_briefing");
    expect(b.team[0].availability).toBe("near_limit: cota acaba em 20 min");
    expect(b.since_last.join("\n")).toMatch(/Ian mudou disponibilidade: near_limit/);
    await expect(agent(tokIan, "mcp_set_availability", ["dormindo", null])).rejects.toThrow(/available, busy/);
  });
});
