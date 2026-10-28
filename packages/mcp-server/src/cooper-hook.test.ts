import { describe, expect, it } from "vitest";
import { eventOf, shouldSend } from "./cooper-hook";

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
});
