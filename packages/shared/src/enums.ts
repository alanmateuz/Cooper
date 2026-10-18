// Valores espelhados nos enums do Postgres (supabase/migrations/0001_init.sql).
// Se mudar aqui, mude lá também.

export const EVENT_SOURCES = ["user", "agent_declared", "agent_hook", "local_git", "github", "tests"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const TASK_STATUSES = ["backlog", "in_progress", "in_review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const AGENT_KINDS = ["claude_code", "codex", "other"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const PRESENCE_STATUSES = ["running", "online", "idle", "unknown"] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

export const TASK_LINK_KINDS = ["branch", "commit", "pr"] as const;
export type TaskLinkKind = (typeof TASK_LINK_KINDS)[number];

export const SOURCE_LABELS: Record<EventSource, string> = {
  user: "usuário",
  agent_declared: "declarado",
  agent_hook: "hook",
  local_git: "git local",
  github: "GitHub",
  tests: "testes",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  in_progress: "Em andamento",
  in_review: "Em revisão",
  done: "Concluído",
};

export const AGENT_LABELS: Record<AgentKind, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  other: "Agente",
};

export const PRESENCE_LABELS: Record<PresenceStatus, string> = {
  running: "Executando",
  online: "Online",
  idle: "Inativo",
  unknown: "Desconhecido",
};
