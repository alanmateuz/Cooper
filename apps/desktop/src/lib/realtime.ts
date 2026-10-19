// Aplica uma mudança do Realtime (INSERT/UPDATE/DELETE) direto no estado do widget,
// sem recarregar a tabela. Função pura: testada em realtime.test.ts.
import type { WorkspaceData } from "./useWorkspace";

export type RealtimeTable = "tasks" | "agent_sessions" | "git_snapshots" | "task_events" | "context_blocks" | "task_links" | "ai_usage";

export interface Change {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  /** linha nova (INSERT/UPDATE) */
  new: Record<string, unknown>;
  /** em DELETE, só a chave primária vem garantida */
  old: Record<string, unknown>;
}

type Row = Record<string, unknown>;

interface Spec {
  field: keyof WorkspaceData;
  key: (r: Row) => string;
  sort?: (a: Row, b: Row) => number;
  limit?: number;
}

const byId = (r: Row) => String(r.id);
const desc = (k: string) => (a: Row, b: Row) => String(b[k] ?? "").localeCompare(String(a[k] ?? ""));

export const SPECS: Record<RealtimeTable, Spec> = {
  tasks: { field: "tasks", key: byId, sort: (a, b) => Number(a.number) - Number(b.number) },
  task_events: { field: "events", key: byId, sort: desc("occurred_at"), limit: 80 },
  agent_sessions: { field: "sessions", key: byId, sort: (a, b) => desc("last_event_at")(a, b) || desc("started_at")(a, b), limit: 50 },
  context_blocks: { field: "context", key: byId, sort: (a, b) => Number(a.position) - Number(b.position) },
  task_links: { field: "links", key: byId },
  git_snapshots: { field: "snapshots", key: byId },
  // uma linha por pessoa e agente no workspace (chave composta)
  ai_usage: { field: "usage", key: (r) => `${String(r.workspace_id)}:${String(r.user_id)}:${String(r.agent_kind)}` },
};

export function applyChange(data: WorkspaceData, table: RealtimeTable, c: Change): WorkspaceData {
  const spec = SPECS[table];
  const list = data[spec.field] as unknown as Row[];
  let next: Row[];
  if (c.eventType === "DELETE") {
    const k = spec.key(c.old);
    next = list.filter((r) => spec.key(r) !== k);
    if (next.length === list.length) return data; // nada a remover (ex.: linha de outro workspace)
  } else {
    if (data.workspace && c.new.workspace_id !== undefined && c.new.workspace_id !== data.workspace.id) return data;
    const k = spec.key(c.new);
    const i = list.findIndex((r) => spec.key(r) === k);
    next = i >= 0 ? list.map((r, j) => (j === i ? { ...r, ...c.new } : r)) : [c.new, ...list];
    if (spec.sort) next = [...next].sort(spec.sort);
    if (spec.limit) next = next.slice(0, spec.limit);
  }
  return { ...data, [spec.field]: next };
}
