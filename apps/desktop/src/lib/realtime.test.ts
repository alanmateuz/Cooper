import { describe, expect, it } from "vitest";
import { applyChange } from "./realtime";
import type { WorkspaceData } from "./useWorkspace";

const WS = "ws-1";
const base = (): WorkspaceData =>
  ({
    workspace: { id: WS, name: "P", created_by: "u", created_at: "" },
    members: [],
    tasks: [
      { id: "t1", workspace_id: WS, number: 1, title: "um", status: "backlog" },
      { id: "t2", workspace_id: WS, number: 2, title: "dois", status: "backlog" },
    ],
    sessions: [],
    snapshots: [],
    events: Array.from({ length: 80 }, (_, i) => ({ id: `e${i}`, workspace_id: WS, occurred_at: `2026-10-19T10:${String(59 - (i % 60)).padStart(2, "0")}:00Z` })),
    context: [],
    links: [],
    usage: [{ workspace_id: WS, user_id: "u", agent_kind: "codex", input_tokens: 1 }],
  }) as unknown as WorkspaceData;

describe("applyChange", () => {
  it("INSERT de tarefa entra na ordem do número", () => {
    const d = applyChange(base(), "tasks", { eventType: "INSERT", new: { id: "t0", workspace_id: WS, number: 0, title: "zero" }, old: {} });
    expect(d.tasks.map((t) => t.id)).toEqual(["t0", "t1", "t2"]);
  });

  it("UPDATE substitui a linha sem recarregar", () => {
    const d = applyChange(base(), "tasks", { eventType: "UPDATE", new: { id: "t2", workspace_id: WS, number: 2, title: "dois!", status: "done" }, old: { id: "t2" } });
    expect(d.tasks.find((t) => t.id === "t2")).toMatchObject({ title: "dois!", status: "done" });
    expect(d.tasks).toHaveLength(2);
  });

  it("DELETE só com a chave primária", () => {
    const d = applyChange(base(), "tasks", { eventType: "DELETE", new: {}, old: { id: "t1" } });
    expect(d.tasks.map((t) => t.id)).toEqual(["t2"]);
  });

  it("DELETE de linha desconhecida não troca o estado (mesma referência)", () => {
    const b = base();
    expect(applyChange(b, "tasks", { eventType: "DELETE", new: {}, old: { id: "x" } })).toBe(b);
  });

  it("ignora linha de outro workspace", () => {
    const b = base();
    expect(applyChange(b, "tasks", { eventType: "INSERT", new: { id: "t9", workspace_id: "outro", number: 9 }, old: {} })).toBe(b);
  });

  it("evento novo entra no topo e a lista fica em 80", () => {
    const d = applyChange(base(), "task_events", { eventType: "INSERT", new: { id: "novo", workspace_id: WS, occurred_at: "2026-10-19T12:00:00Z" }, old: {} });
    expect(d.events[0]!.id).toBe("novo");
    expect(d.events).toHaveLength(80);
  });

  it("ai_usage usa a chave composta", () => {
    const up = applyChange(base(), "ai_usage", { eventType: "UPDATE", new: { workspace_id: WS, user_id: "u", agent_kind: "codex", input_tokens: 5 }, old: {} });
    expect(up.usage).toHaveLength(1);
    expect(up.usage[0]!.input_tokens).toBe(5);
    const other = applyChange(base(), "ai_usage", { eventType: "INSERT", new: { workspace_id: WS, user_id: "u", agent_kind: "claude_code", input_tokens: 1 }, old: {} });
    expect(other.usage).toHaveLength(2);
    const del = applyChange(base(), "ai_usage", { eventType: "DELETE", new: {}, old: { workspace_id: WS, user_id: "u", agent_kind: "codex" } });
    expect(del.usage).toHaveLength(0);
  });
});
