// Sobe o servidor compilado (dist/index.js) via stdio e confere o que o agente recebe ao conectar.
// Não chama o Supabase: listar ferramentas não precisa de rede. Requer `pnpm mcp:build` antes.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));
let client: Client;

describe.skipIf(!existsSync(SERVER))("servidor MCP", () => {
  beforeAll(async () => {
    client = new Client({ name: "teste", version: "0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [SERVER],
        env: { ...(process.env as Record<string, string>), COOPER_TOKEN: "coop_" + "0".repeat(48), COOPER_SUPABASE_URL: "http://127.0.0.1:9", COOPER_SUPABASE_ANON_KEY: "x" },
        stderr: "ignore",
      }),
    );
  });
  afterAll(() => client?.close());

  it("expõe get_briefing e patch_context_block, sem get_my_tasks nem get_team_status", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "accept_task", "complete_task", "create_context_block", "create_task", "decline_task", "get_briefing",
        "get_task_context", "get_workspace_context", "patch_context_block", "report_progress", "start_task", "update_context_block",
      ].sort(),
    );
  });

  it("instruções e descrições continuam curtas", async () => {
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toMatch(/get_briefing/);
    expect(instructions.length).toBeLessThan(900);
    const { tools } = await client.listTools();
    for (const t of tools) expect(t.description!.length, t.name).toBeLessThanOrEqual(220);
  });

  it("informa a versão do package.json", () => {
    expect(client.getServerVersion()?.version).not.toBe("dev");
  });
});
