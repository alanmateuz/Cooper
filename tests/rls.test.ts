// Testes de isolamento entre workspaces (critério de aceite 10), contra o projeto Supabase.
// Pré-requisitos: migrações aplicadas (`pnpm db:push`) e seed (`pnpm db:seed`).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} ausente: rode pnpm db:seed antes`);
  return v;
};

async function signIn(who: "ALAN" | "BIA" | "INTRUSO"): Promise<SupabaseClient> {
  const c = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email: env(`TEST_${who}_EMAIL`), password: env(`TEST_${who}_PASSWORD`) });
  if (error) throw error;
  return c;
}

const wsByName = async (c: SupabaseClient, name: string) =>
  (await c.from("workspaces").select("id,name").eq("name", name).maybeSingle()).data;

describe.skipIf(!SUPABASE_URL || !SUPABASE_ANON_KEY)("RLS por workspace", () => {
  let alan: SupabaseClient, bia: SupabaseClient, intruso: SupabaseClient, anon: SupabaseClient;
  let demoId: string, otherId: string;

  beforeAll(async () => {
    [alan, bia, intruso] = await Promise.all([signIn("ALAN"), signIn("BIA"), signIn("INTRUSO")]);
    anon = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    demoId = (await wsByName(alan, "Hacko (demo)"))!.id;
    otherId = (await wsByName(intruso, "Outro (isolamento)"))!.id;
  });

  it("os dois membros veem o mesmo workspace e as mesmas tarefas", async () => {
    const a = await alan.from("tasks").select("id").eq("workspace_id", demoId);
    const b = await bia.from("tasks").select("id").eq("workspace_id", demoId);
    expect(a.error).toBeNull();
    expect(a.data!.length).toBeGreaterThan(0);
    expect(b.data!.map((t) => t.id).sort()).toEqual(a.data!.map((t) => t.id).sort());
  });

  it("intruso não vê o workspace nem as tarefas do outro time", async () => {
    expect(await wsByName(intruso, "Hacko (demo)")).toBeNull();
    for (const table of ["tasks", "task_events", "agent_sessions", "git_snapshots", "context_entries", "workspace_members", "repositories"]) {
      const r = await intruso.from(table).select("*").eq("workspace_id", demoId);
      expect(r.error, table).toBeNull();
      expect(r.data, table).toEqual([]);
    }
  });

  it("membro do demo não vê o workspace isolado", async () => {
    const r = await alan.from("tasks").select("id").eq("workspace_id", otherId);
    expect(r.data).toEqual([]);
  });

  it("intruso não cria tarefa nem evento no workspace alheio", async () => {
    const me = (await intruso.auth.getUser()).data.user!.id;
    const t = await intruso.from("tasks").insert({ workspace_id: demoId, title: "invasão", created_by: me });
    expect(t.error).not.toBeNull();
    const e = await intruso.from("task_events").insert({ workspace_id: demoId, user_id: me, source: "user", type: "note" });
    expect(e.error).not.toBeNull();
  });

  it("intruso não altera nem apaga tarefa alheia (0 linhas afetadas)", async () => {
    const id = (await alan.from("tasks").select("id").eq("workspace_id", demoId).limit(1).single()).data!.id;
    const u = await intruso.from("tasks").update({ title: "alterado" }).eq("id", id).select();
    expect(u.data ?? []).toEqual([]);
    const d = await intruso.from("tasks").delete().eq("id", id).select();
    expect(d.data ?? []).toEqual([]);
    const still = await alan.from("tasks").select("title").eq("id", id).single();
    expect(still.data!.title).not.toBe("alterado");
  });

  it("intruso não se adiciona como membro", async () => {
    const me = (await intruso.auth.getUser()).data.user!.id;
    const r = await intruso.from("workspace_members").insert({ workspace_id: demoId, user_id: me });
    expect(r.error).not.toBeNull();
  });

  it("membro não se passa por GitHub nem por hook", async () => {
    const me = (await bia.auth.getUser()).data.user!.id;
    for (const source of ["github", "agent_hook", "tests"]) {
      const r = await bia.from("task_events").insert({ workspace_id: demoId, user_id: me, source, type: "push" });
      expect(r.error, source).not.toBeNull();
    }
  });

  it("membro não registra evento em nome de outro membro", async () => {
    const alanId = (await alan.auth.getUser()).data.user!.id;
    const r = await bia.from("task_events").insert({ workspace_id: demoId, user_id: alanId, source: "user", type: "note" });
    expect(r.error).not.toBeNull();
  });

  it("membro não grava git_snapshot de outra pessoa", async () => {
    const r = await bia.from("git_snapshots").update({ branch: "falso" }).eq("workspace_id", demoId).neq("user_id", (await bia.auth.getUser()).data.user!.id).select();
    expect(r.data ?? []).toEqual([]);
  });

  it("anônimo não lê nada", async () => {
    const r = await anon.from("tasks").select("id");
    expect(r.data ?? []).toEqual([]);
  });

  it("criar tarefa gera número sequencial e evento fica visível ao outro membro", async () => {
    const me = (await bia.auth.getUser()).data.user!.id;
    const t = await bia.from("tasks").insert({ workspace_id: demoId, title: "teste RLS", created_by: me }).select().single();
    expect(t.error).toBeNull();
    expect(t.data!.number).toBeGreaterThan(0);
    const seen = await alan.from("tasks").select("id").eq("id", t.data!.id).single();
    expect(seen.data?.id).toBe(t.data!.id);
    await alan.from("tasks").delete().eq("id", t.data!.id); // Alan é dono
  });
});
