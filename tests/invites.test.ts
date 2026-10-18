// Convites: só o dono convida; só o dono do e-mail aceita; depois de aceitar, vira membro.
// Usa o Intruso como convidado e desfaz tudo no fim (os testes de RLS dependem dele isolado).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

describe.skipIf(!SUPABASE_URL || !SUPABASE_ANON_KEY)("convites", () => {
  let alan: SupabaseClient, bia: SupabaseClient, intruso: SupabaseClient;
  let demoId: string, intrusoId: string, alanId: string, inviteId: string;

  beforeAll(async () => {
    [alan, bia, intruso] = await Promise.all([signIn("ALAN"), signIn("BIA"), signIn("INTRUSO")]);
    demoId = (await alan.from("workspaces").select("id").eq("name", "Hacko (demo)").single()).data!.id;
    intrusoId = (await intruso.auth.getUser()).data.user!.id;
    alanId = (await alan.auth.getUser()).data.user!.id;
    await alan.from("workspace_invites").delete().eq("workspace_id", demoId); // sobras de execução anterior
  });

  afterAll(async () => {
    await alan.from("workspace_members").delete().eq("workspace_id", demoId).eq("user_id", intrusoId);
    await alan.from("workspace_invites").delete().eq("workspace_id", demoId);
  });

  it("membro que não é dono não convida", async () => {
    const me = (await bia.auth.getUser()).data.user!.id;
    const r = await bia.from("workspace_invites").insert({ workspace_id: demoId, email: "x@example.com", invited_by: me });
    expect(r.error).not.toBeNull();
  });

  it("dono convida; e-mail malformado ou repetido é recusado", async () => {
    const bad = await alan.from("workspace_invites").insert({ workspace_id: demoId, email: "não-é-email", invited_by: alanId });
    expect(bad.error).not.toBeNull();
    const ok = await alan
      .from("workspace_invites")
      .insert({ workspace_id: demoId, email: env("TEST_INTRUSO_EMAIL"), invited_by: alanId })
      .select("id")
      .single();
    expect(ok.error).toBeNull();
    inviteId = ok.data!.id;
    const dup = await alan.from("workspace_invites").insert({ workspace_id: demoId, email: env("TEST_INTRUSO_EMAIL"), invited_by: alanId });
    expect(dup.error?.code).toBe("23505");
  });

  it("o convidado vê o convite antes de aceitar, mas ainda não vê o workspace", async () => {
    const { data } = await intruso.rpc("my_pending_invites");
    expect(data.map((i: { workspace_name: string }) => i.workspace_name)).toContain("Hacko (demo)");
    const tasks = await intruso.from("tasks").select("id").eq("workspace_id", demoId);
    expect(tasks.data).toEqual([]);
  });

  it("outra pessoa não aceita convite que não é dela", async () => {
    const r = await bia.rpc("accept_invite", { p_invite: inviteId });
    expect(r.error?.message).toMatch(/não encontrado/);
  });

  it("o convidado aceita e passa a ver o workspace", async () => {
    const r = await intruso.rpc("accept_invite", { p_invite: inviteId });
    expect(r.error).toBeNull();
    expect(r.data).toBe(demoId);
    const tasks = await intruso.from("tasks").select("id").eq("workspace_id", demoId);
    expect(tasks.data!.length).toBeGreaterThan(0);
    const again = await intruso.rpc("accept_invite", { p_invite: inviteId });
    expect(again.error).not.toBeNull(); // convite já usado
  });
});
