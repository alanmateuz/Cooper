// Migração 0014: metadados de anexos das tarefas (o arquivo em si fica no Supabase Storage).
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { asUser, createUser, freshDb, one } from "./harness";

type U = { id: string; email: string };
let db: PGlite;
let owner: U, member: U, outsider: U;
let ws: string, task: string;

beforeEach(async () => {
  db = await freshDb();
  owner = { id: await createUser(db, "dono@example.com", "Dono"), email: "dono@example.com" };
  member = { id: await createUser(db, "membro@example.com", "Membro"), email: "membro@example.com" };
  outsider = { id: await createUser(db, "fora@example.com", "Fora"), email: "fora@example.com" };
  ws = (await one(db.query<{ id: string }>("insert into public.workspaces (name, created_by) values ('P', $1) returning id", [owner.id]))).id;
  await db.query("insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')", [ws, member.id]);
  task = (await asUser(db, owner, (tx) =>
    one(tx.query<{ id: string }>("insert into public.tasks (workspace_id, title, created_by) values ($1, 'T', $2) returning id", [ws, owner.id])))).id;
});

const attach = (u: U, name = "spec.pdf", path?: string) =>
  asUser(db, u, (tx) =>
    one(tx.query<{ id: string }>(
      "insert into public.task_attachments (workspace_id, task_id, path, name, size_bytes, uploaded_by) values ($1, $2, $3, $4, 1200, $5) returning id",
      [ws, task, path ?? `${ws}/${task}/${crypto.randomUUID()}-${name}`, name, u.id])));
const count = async () => (await one(db.query<{ n: number }>("select count(*)::int n from public.task_attachments"))).n;

describe("anexos", () => {
  it("membro anexa; vira evento na tarefa", async () => {
    await attach(member);
    expect(await count()).toBe(1);
    const ev = await one(db.query<{ payload: { name: string } }>("select payload from public.task_events where type = 'attachment_added'"));
    expect(ev.payload.name).toBe("spec.pdf");
  });

  it("quem não é membro não vê nem anexa", async () => {
    await attach(member);
    await expect(attach(outsider)).rejects.toThrow();
    const seen = await asUser(db, outsider, (tx) => tx.query("select * from public.task_attachments"));
    expect(seen.rows).toEqual([]);
  });

  it("caminho precisa ser a pasta da tarefa; limite de 20 por tarefa; tamanho até 10 MB", async () => {
    await expect(attach(member, "x", `outro/${task}/x`)).rejects.toThrow(/fora da pasta/);
    await expect(asUser(db, member, (tx) =>
      tx.query("insert into public.task_attachments (workspace_id, task_id, path, name, size_bytes, uploaded_by) values ($1, $2, $3, 'g', 20000000, $4)",
        [ws, task, `${ws}/${task}/g`, member.id]))).rejects.toThrow();
    for (let i = 0; i < 20; i++) await attach(member, `f${i}`);
    await expect(attach(member, "f20")).rejects.toThrow(/20 anexos/);
  });

  it("apaga quem enviou ou o dono; outro membro não", async () => {
    const mine = await attach(owner);
    const r = await asUser(db, member, (tx) => tx.query("delete from public.task_attachments where id = $1", [mine.id]));
    expect(r.affectedRows ?? 0).toBe(0);
    await asUser(db, owner, (tx) => tx.query("delete from public.task_attachments where id = $1", [mine.id]));
    expect(await count()).toBe(0);
    const theirs = await attach(member);
    await asUser(db, owner, (tx) => tx.query("delete from public.task_attachments where id = $1", [theirs.id]));
    expect(await count()).toBe(0);
  });
});
