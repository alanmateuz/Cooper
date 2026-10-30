import { describe, expect, it } from "vitest";
import { agentOf, approvesPr, commandOf, eventOf, shouldSend } from "./cooper-hook";

describe("cooper-hook", () => {
  it("só o nome do evento sai do JSON", () => {
    expect(eventOf({ hook_event_name: "PreToolUse", tool_input: { command: "segredo" }, cwd: "C:/x" })).toBe("pre_tool_use");
    expect(eventOf({ hook_event_name: "Notification" })).toBeNull();
    expect(eventOf(null)).toBeNull();
  });
  it("não repete o mesmo evento em 20 s; stop sempre passa", () => {
    const now = 1_000_000;
    expect(shouldSend("pre_tool_use", { event: "pre_tool_use", at: now - 5_000 }, now)).toBe(false);
    expect(shouldSend("pre_tool_use", { event: "pre_tool_use", at: now - 25_000 }, now)).toBe(true);
    expect(shouldSend("pre_tool_use", { event: "stop", at: now }, now)).toBe(true);
    expect(shouldSend("stop", { event: "stop", at: now }, now)).toBe(true);
  });
  it("agente pelo argumento", () => {
    expect(agentOf("codex")).toBe("codex");
    expect(agentOf(undefined)).toBe("claude_code");
  });
  it("reconhece aprovar e fazer merge de PR", () => {
    expect(approvesPr("gh pr merge 12 --squash")).toBe(true);
    expect(approvesPr("gh pr review 12 --approve")).toBe(true);
    expect(approvesPr("gh pr review 12 -a -b ok")).toBe(true);
    expect(approvesPr("gh api -X PUT repos/a/b/pulls/12/merge")).toBe(true);
    expect(approvesPr("gh pr review 12 --comment -b 'veja'")).toBe(false);
    expect(approvesPr("gh pr create --fill")).toBe(false);
    expect(approvesPr("git merge main")).toBe(false);
  });
  it("lê o comando do Claude Code e do Codex", () => {
    expect(commandOf({ tool_input: { command: "gh pr merge 1" } })).toBe("gh pr merge 1");
    expect(commandOf({ tool_input: { command: ["gh", "pr", "merge", "1"] } })).toBe("gh pr merge 1");
    expect(commandOf({ tool_input: { file_path: "a.ts" } })).toBeNull();
  });
});
