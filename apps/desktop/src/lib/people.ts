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
