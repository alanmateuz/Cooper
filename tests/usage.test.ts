// Etapa 3 da nova direção: uso de IA nos perfis (critérios 2 e 3 da seção 3.2).
// O critério "nenhum campo de texto dos JSONL é enviado" também é coberto por
// apps/desktop/src-tauri/src/ai_usage.rs (leitor) e packages/shared/src/usage.test.ts (linha enviada).
import { usageRows, type UsageReport } from "../packages/shared/src/usage.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} ausente: rode pnpm db:seed antes`);
  return v;
};

async function signIn(who: "ALAN" | "BIA" | "INTRUSO"): Promise<{ c: SupabaseClient; id: string }> {
  const c = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: env(`TEST_${who}_EMAIL`), password: env(`TEST_${who}_PASSWORD`) });
  if (error) throw error;
  return { c, id: data.user.id };
}

const report: UsageReport = {
  claude_code: null,
  codex: {
    tokens: { input: 300, output: 20, cache_read: 200, cache_write: 0 },
    models: ["gpt-5.5-codex"],
    primary: { used_pct: 13, window_minutes: 300, resets_at: 4102444800 },
    secondary: { used_pct: 18, window_minutes: 10080, resets_at: 4102444800 },
    last_event_at: null,
  },
};

describe.skipIf(!SUPABASE_URL || !SUPABASE_ANON_KEY)("uso de IA compartilhado", () => {
  let alan: { c: SupabaseClient; id: string }, bia: { c: SupabaseClient; id: string }, intruso: { c: SupabaseClient; id: string };
  let ws: string;
  const rows = () => usageRows(report, ws, alan.id, "2026-10-18");
  const biaSees = async () => (await bia.c.from("ai_usage").select("agent_kind,input_tokens").eq("user_id", alan.id).eq("workspace_id", ws)).data;

  beforeAll(async () => {
    [alan, bia, intruso] = await Promise.all([signIn("ALAN"), signIn("BIA"), signIn("INTRUSO")]);
    ws = (await alan.c.from("workspaces").select("id").eq("name", "Hacko (demo)").single()).data!.id;
    await alan.c.rpc("set_usage_sharing", { p_workspace: ws, p_on: false });
  });
  afterAll(async () => {
    await alan?.c.rpc("set_usage_sharing", { p_workspace: ws, p_on: false });
  });

  it("começa desligado", async () => {
    const m = await alan.c.from("workspace_members").select("share_usage").eq("workspace_id", ws).eq("user_id", bia.id).single();
    expect(m.data!.share_usage).toBe(false);
  });

  it("critério 2: desligado, o banco recusa o envio e o outro membro não recebe nada", async () => {
    const r = await alan.c.from("ai_usage").upsert(rows(), { onConflict: "workspace_id,user_id,agent_kind" });
    expect(r.error?.message).toMatch(/row-level security/);
    expect(await biaSees()).toEqual([]);
  });

  it("critério 1: ligado, o outro membro vê tokens e limite; desligar apaga", async () => {
    expect((await alan.c.rpc("set_usage_sharing", { p_workspace: ws, p_on: true })).error).toBeNull();
    const r = await alan.c.from("ai_usage").upsert(rows(), { onConflict: "workspace_id,user_id,agent_kind" });
    expect(r.error).toBeNull();
    const seen = await bia.c.from("ai_usage").select("*").eq("user_id", alan.id).eq("workspace_id", ws).single();
    expect(seen.data).toMatchObject({ agent_kind: "codex", input_tokens: 300, primary_used_pct: 13, secondary_used_pct: 18, models: ["gpt-5.5-codex"] });

    await alan.c.rpc("set_usage_sharing", { p_workspace: ws, p_on: false });
    expect(await biaSees()).toEqual([]);
  });

  it("ninguém grava uso em nome de outra pessoa nem fora do próprio workspace", async () => {
    await bia.c.rpc("set_usage_sharing", { p_workspace: ws, p_on: true });
    const asAlan = await bia.c.from("ai_usage").insert(rows()[0]!);
    expect(asAlan.error).not.toBeNull();
    await bia.c.rpc("set_usage_sharing", { p_workspace: ws, p_on: false });

    const other = await intruso.c.rpc("set_usage_sharing", { p_workspace: ws, p_on: true });
    expect(other.error?.message).toMatch(/não é membro/);
    expect((await intruso.c.from("ai_usage").select("*").eq("workspace_id", ws)).data).toEqual([]);
  });

  it("o banco só aceita nome de modelo comportado (nada de texto livre)", async () => {
    await alan.c.rpc("set_usage_sharing", { p_workspace: ws, p_on: true });
    const bad = await alan.c.from("ai_usage").upsert({ ...rows()[0]!, models: ["modelo com texto livre"] }, { onConflict: "workspace_id,user_id,agent_kind" });
    expect(bad.error?.message).toMatch(/check constraint/);
    await alan.c.rpc("set_usage_sharing", { p_workspace: ws, p_on: false });
  });
});
