// Status line do Claude Code (limites de 5 h e semana): roda o script empacotado como o Claude Code roda,
// com um JSON de sessão no stdin. Não precisa do Supabase.
// Pré-requisito: pnpm mcp:build.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../packages/mcp-server/dist/cooper-statusline.js", import.meta.url));
const SECRET = "SEGREDO-da-sessao";

const session = (rateLimits?: unknown) =>
  JSON.stringify({
    session_id: SECRET,
    transcript_path: `C:/${SECRET}/x.jsonl`,
    cwd: `C:/${SECRET}`,
    model: { id: "claude-opus-5-5", display_name: "Opus 5.5" },
    workspace: { current_dir: `C:/${SECRET}` },
    cost: { total_cost_usd: 1.23 },
    ...(rateLimits ? { rate_limits: rateLimits } : {}),
  });

function run(input: string, home: string) {
  return spawnSync(process.execPath, [SCRIPT], { input, encoding: "utf8", env: { ...process.env, COOPER_HOME: home } });
}

describe("status line do Cooper", () => {
  it("guarda só os limites, nada de texto da sessão", () => {
    const home = mkdtempSync(join(tmpdir(), "cooper-sl-"));
    const r = run(
      session({ five_hour: { used_percentage: 23.5, resets_at: 1738425600 }, seven_day: { used_percentage: 41.2, resets_at: 1738857600, extra: SECRET } }),
      home,
    );
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("Opus 5.5 · 5h 24% · semana 41%");
    const raw = readFileSync(join(home, "claude-limits.json"), "utf8");
    expect(raw).not.toContain("SEGREDO");
    const saved = JSON.parse(raw);
    expect(Object.keys(saved).sort()).toEqual(["five_hour", "observed_at", "seven_day"]);
    expect(saved.five_hour).toEqual({ used_percentage: 23.5, resets_at: 1738425600 });
    expect(saved.seven_day).toEqual({ used_percentage: 41.2, resets_at: 1738857600 });
  });

  it("sem rate_limits (API key, antes da 1ª resposta) não grava nada", () => {
    const home = mkdtempSync(join(tmpdir(), "cooper-sl-"));
    const r = run(session(), home);
    expect(r.stdout.trim()).toBe("Opus 5.5");
    expect(existsSync(join(home, "claude-limits.json"))).toBe(false);
    expect(JSON.parse(readFileSync(join(home, "statusline-seen.json"), "utf8"))).toEqual({ at: expect.any(Number), rate_limits: false });
  });

  it("JSON quebrado não derruba a status line", () => {
    const home = mkdtempSync(join(tmpdir(), "cooper-sl-"));
    const r = run("isso não é json", home);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("Claude Code");
  });

  it("mantém a status line que a pessoa já tinha", () => {
    const home = mkdtempSync(join(tmpdir(), "cooper-sl-"));
    writeFileSync(join(home, "statusline.json"), JSON.stringify({ previous: { type: "command", command: "node -e \"process.stdout.write('linha antiga')\"" } }));
    const r = run(session({ five_hour: { used_percentage: 10, resets_at: 1738425600 } }), home);
    expect(r.stdout).toBe("linha antiga");
    expect(JSON.parse(readFileSync(join(home, "claude-limits.json"), "utf8")).five_hour.used_percentage).toBe(10);
  });
});
