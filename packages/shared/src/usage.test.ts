import { describe, expect, it } from "vitest";
import { aiUsageRowSchema, usageRows, viewsFromRows, type UsageReport } from "./usage.js";

const WS = "00000000-0000-4000-8000-000000000001";
const ME = "00000000-0000-4000-8000-000000000002";

const report = (extra: Record<string, unknown> = {}): UsageReport =>
  ({
    claude_code: { tokens: { input: 2, output: 30, cache_read: 100, cache_write: 50 }, models: ["claude-opus-5-5"], primary: null, secondary: null, last_event_at: 1 },
    codex: {
      tokens: { input: 300, output: 20, cache_read: 200, cache_write: 0 },
      models: ["gpt-5.5-codex"],
      primary: { used_pct: 13, window_minutes: 300, resets_at: 4102444800 },
      secondary: null,
      last_event_at: 1,
      ...extra,
    },
  }) as UsageReport;

describe("usageRows", () => {
  it("monta uma linha por agente, só com números e modelo", () => {
    const rows = usageRows(report(), WS, ME, "2026-10-18", new Date("2026-10-18T12:00:00Z"));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ agent_kind: "codex", input_tokens: 300, primary_used_pct: 13, primary_resets_at: "2100-01-01T00:00:00.000Z" });
  });

  it("nenhum texto do leitor chega à linha enviada", () => {
    const secret = "SEGREDO do prompt";
    // mesmo que o leitor devolvesse campos a mais ou um modelo estranho, nada disso sai
    const rows = usageRows(report({ prompt: secret, cwd: secret, models: ["gpt-5", secret] }), WS, ME, "2026-10-18");
    expect(JSON.stringify(rows)).not.toContain("SEGREDO");
    expect(rows[1]!.models).toEqual(["gpt-5"]);
  });

  it("o esquema recusa campos de texto extras", () => {
    const [row] = usageRows(report(), WS, ME, "2026-10-18");
    expect(() => aiUsageRowSchema.parse({ ...row, note: "conversa" })).toThrow();
  });
});

describe("viewsFromRows", () => {
  it("ignora outro dia e limite cujo reinício já passou", () => {
    const now = new Date("2026-10-18T12:00:00Z");
    const [today, old] = [
      usageRows(report(), WS, ME, "2026-10-18")[1]!,
      { ...usageRows(report(), WS, ME, "2026-10-17")[0]! },
    ];
    const views = viewsFromRows([today, old, { ...today, primary_resets_at: "2026-10-18T11:00:00Z" }], "2026-10-18", now);
    expect(views).toHaveLength(2);
    expect(views[0]!.primary?.pct).toBe(13);
    expect(views[1]!.primary).toBeNull();
  });
});
