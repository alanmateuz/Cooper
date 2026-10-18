import type { PresenceStatus } from "./enums.js";

/** Limites padrão (configuráveis por workspace no futuro). */
export const PRESENCE_DEFAULTS = {
  /** Evento de execução observado há no máximo isto → "Executando". */
  runningWindowMs: 2 * 60_000,
  /** Sessão aberta com evento há no máximo isto → "Online". */
  onlineWindowMs: 30 * 60_000,
} as const;

/** Eventos que comprovam que o agente está executando algo agora. */
export const EXECUTION_EVENT_TYPES = new Set(["user_prompt_submit", "pre_tool_use", "post_tool_use"]);

export interface SessionEvidence {
  /** Só sessões com hooks configurados produzem evidência observada. */
  hasHooks: boolean;
  startedAt: string | null;
  endedAt: string | null;
  lastEventAt: string | null;
  lastEventType: string | null;
}

/**
 * Status de presença derivado só de evidência.
 * Nunca retorna "running" por existir branch ou tarefa em andamento.
 */
export function computePresence(
  s: SessionEvidence,
  now: Date = new Date(),
  limits: { runningWindowMs: number; onlineWindowMs: number } = PRESENCE_DEFAULTS,
): PresenceStatus {
  if (!s.hasHooks) return "unknown";
  if (!s.lastEventAt) return s.startedAt ? "idle" : "unknown";

  const age = now.getTime() - new Date(s.lastEventAt).getTime();
  if (Number.isNaN(age)) return "unknown";

  // Evento no futuro = relógio dessincronizado; tratar como agora.
  const ageMs = Math.max(0, age);
  const ended = s.endedAt !== null && new Date(s.endedAt).getTime() >= new Date(s.lastEventAt).getTime();
  if (ended) return "idle";

  if (ageMs <= limits.runningWindowMs && s.lastEventType && EXECUTION_EVENT_TYPES.has(s.lastEventType)) {
    return "running";
  }
  if (ageMs <= limits.onlineWindowMs) return "online";
  return "idle";
}

const RANK: Record<PresenceStatus, number> = { running: 3, online: 2, idle: 1, unknown: 0 };

/** Status de uma pessoa = o mais forte entre as sessões dela. */
export function strongestPresence(statuses: PresenceStatus[]): PresenceStatus {
  return statuses.reduce<PresenceStatus>((best, s) => (RANK[s] > RANK[best] ? s : best), "unknown");
}
