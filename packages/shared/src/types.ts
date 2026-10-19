import type { AgentKind, EventSource, TaskLinkKind, TaskStatus } from "./enums.js";
import type { TaskEventPayload } from "./schemas.js";

// Linhas como o PostgREST as devolve. Mantidas à mão no MVP;
// trocar por `supabase gen types` quando o esquema estabilizar.

export interface Profile {
  id: string;
  display_name: string;
  avatar_color: string;
}

export interface Workspace {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
}

export interface WorkspaceMember {
  workspace_id: string;
  user_id: string;
  role: "owner" | "member";
  joined_at: string;
}

export interface Task {
  id: string;
  workspace_id: string;
  number: number;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  /** O que a IA de quem receber deve executar. Descrição da tarefa, não instrução de sistema. */
  prompt: string | null;
  status: TaskStatus;
  assignee_id: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TaskLink {
  id: string;
  task_id: string;
  kind: TaskLinkKind;
  ref: string;
  source: EventSource;
}

export interface TaskEvent {
  id: string;
  workspace_id: string;
  task_id: string | null;
  user_id: string | null;
  agent_session_id: string | null;
  source: EventSource;
  type: string;
  occurred_at: string;
  payload: TaskEventPayload;
}

export interface AgentSession {
  id: string;
  workspace_id: string;
  user_id: string;
  agent_kind: AgentKind;
  client_session_id: string;
  has_hooks: boolean;
  current_task_id: string | null;
  activity_text: string | null;
  started_at: string;
  last_event_at: string | null;
  last_event_type: string | null;
  ended_at: string | null;
}

export interface GitSnapshot {
  id: string;
  workspace_id: string;
  user_id: string;
  repository_id: string;
  branch: string | null;
  head_sha: string | null;
  ahead: number | null;
  behind: number | null;
  dirty_files_count: number;
  observed_at: string;
}

export interface ContextEntry {
  id: string;
  workspace_id: string;
  kind: "summary" | "architecture" | "convention";
  title: string;
  body: string;
  position: number;
}
