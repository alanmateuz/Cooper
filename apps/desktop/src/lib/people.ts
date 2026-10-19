import {
  computePresence,
  strongestPresence,
  type AgentSession,
  type GitSnapshot,
  type PresenceStatus,
  type Profile,
  type Task,
} from "@cooper/shared";
import type { WorkspaceData } from "./useWorkspace";

export interface PersonView {
  userId: string;
  profile: Profile;
  presence: PresenceStatus;
  /** Sessão mais recente (a que define o que o cartão mostra). */
  session: AgentSession | null;
  sessionPresence: PresenceStatus;
  /** Outras sessões ainda ativas (ex.: Claude Code e Codex ao mesmo tempo). */
  otherSessions: { session: AgentSession; presence: PresenceStatus }[];
  task: Task | null;
  snapshot: GitSnapshot | null;
  lastSeenAt: string | null;
}

const sessionPresence = (s: AgentSession, now: Date) =>
  computePresence(
    { hasHooks: s.has_hooks, startedAt: s.started_at, endedAt: s.ended_at, lastEventAt: s.last_event_at, lastEventType: s.last_event_type },
    now,
  );

/**
 * Cores de avatar: todas leem bem com iniciais brancas, no tema claro e no escuro.
 * O roxo da paleta (#4f46e5) é diferente do padrão do banco (#6366f1): escolher roxo precisa contar como escolha.
 */
export const AVATAR_COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#14b8a6", "#f97316", "#65a30d"];
const DEFAULT_COLOR = "#6366f1";

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/**
 * Uma cor por pessoa no workspace. Quem escolheu uma cor fica com ela (o primeiro, se dois escolherem a mesma);
 * quem está na cor padrão ou repetida ganha uma livre da paleta, sempre a mesma em todas as máquinas.
 */
export function distinctColors(people: { user_id: string; color: string | null }[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  const chosen = people.filter((p) => p.color && p.color.toLowerCase() !== DEFAULT_COLOR);
  for (const p of chosen) {
    const c = p.color!.toLowerCase();
    if (used.has(c)) continue;
    used.add(c);
    out.set(p.user_id, p.color!);
  }
  const rest = people.filter((p) => !out.has(p.user_id)).sort((a, b) => a.user_id.localeCompare(b.user_id));
  for (const p of rest) {
    let i = hash(p.user_id) % AVATAR_COLORS.length;
    for (let k = 0; k < AVATAR_COLORS.length && used.has(AVATAR_COLORS[i]!); k++) i = (i + 1) % AVATAR_COLORS.length;
    const c = AVATAR_COLORS[i]!;
    used.add(c);
    out.set(p.user_id, c);
  }
  return out;
}

const latest = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

export function buildPeople(d: WorkspaceData, now: Date): PersonView[] {
  const people = d.members.map((m): PersonView => {
    const profile = m.profile ?? { id: m.user_id, display_name: "Membro", avatar_color: "#64748b" };
    const sessions = d.sessions
      .filter((s) => s.user_id === m.user_id)
      .map((s) => ({ session: s, presence: sessionPresence(s, now) }))
      .sort((a, b) => (b.session.last_event_at ?? b.session.started_at).localeCompare(a.session.last_event_at ?? a.session.started_at));
    const main = sessions[0] ?? null;
    const snapshot = d.snapshots
      .filter((s) => s.user_id === m.user_id)
      .sort((a, b) => b.observed_at.localeCompare(a.observed_at))[0] ?? null;
    const task =
      (main?.session.current_task_id && d.tasks.find((t) => t.id === main.session.current_task_id)) ||
      d.tasks.find((t) => t.assignee_id === m.user_id && t.status === "in_progress") ||
      null;
    return {
      userId: m.user_id,
      profile,
      presence: strongestPresence(sessions.map((s) => s.presence)),
      session: main?.session ?? null,
      sessionPresence: main?.presence ?? "unknown",
      otherSessions: sessions.slice(1).filter((s) => s.presence === "running" || s.presence === "online"),
      task,
      snapshot,
      lastSeenAt: latest(main?.session.last_event_at ?? null, snapshot?.observed_at ?? null),
    };
  });
  const rank: Record<PresenceStatus, number> = { running: 0, online: 1, idle: 2, unknown: 3 };
  return people.sort((a, b) => rank[a.presence] - rank[b.presence] || a.profile.display_name.localeCompare(b.profile.display_name));
}
