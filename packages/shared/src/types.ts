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
  /** só pessoas concluem tarefas e aprovam PRs (servidor no esquema 18; ausente em servidores antigos) */
  require_human_review?: boolean;
}

export interface WorkspaceMember {
  workspace_id: string;
  user_id: string;
  role: "owner" | "member";
  joined_at: string;
  /** Compartilha o uso de IA com o time (⚙ → Privacidade). Desligado por padrão. */
  share_usage: boolean;
  /** A IA desta pessoa coordena o time (⚙ → IA e tarefas). Desligado por padrão. */
  ai_coordinator: boolean;
  /** Tarefas enviadas a esta pessoa entram aceitas. Desligado por padrão. */
  auto_accept: boolean;
  /** Acesso ao repositório do time lido do GitHub pelo app da pessoa (servidor no esquema 20; null sem token). */
  repo_access?: "write" | "read" | "none" | null;
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
  /** Tarefa-mãe (um nível de subtarefas). */
  parent_id: string | null;
  /** 0 nenhuma, 1 baixa, 2 média, 3 alta, 4 urgente. */
  priority: number;
  /** Prazo (AAAA-MM-DD), opcional. */
  due_on: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TaskLink {
  id: string;
  task_id: string;
  kind: TaskLinkKind;
  ref: string;
  /** link (PRs lidos do GitHub trazem o endereço) */
  url?: string | null;
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

/** Bloco de contexto livre (Resumo, Arquitetura, Contratos de API…). Escrita só pelas RPCs context_*. */
export interface ContextBlock {
  id: string;
  workspace_id: string;
  title: string;
  content: string;
  position: number;
  version: number;
  updated_by: string | null;
  updated_source: EventSource;
  updated_agent: AgentKind | null;
  updated_at: string;
  created_at: string;
  deleted_at: string | null;
}

/** Versão substituída de um bloco: conteúdo que existia, quem tinha escrito e quem substituiu. */
export interface ContextBlockVersion {
  id: string;
  block_id: string;
  version: number;
  title: string;
  content: string;
  written_by: string | null;
  written_source: EventSource;
  written_agent: AgentKind | null;
  written_at: string;
  replaced_by: string | null;
  replaced_source: EventSource;
  replaced_agent: AgentKind | null;
  replaced_at: string;
  action: "update" | "restore" | "delete";
}

/** Resposta das RPCs de escrita de contexto. `conflict`: o bloco mudou desde base_version; nada foi gravado. */
export type ContextWriteResult =
  | { ok: true; id: string; title: string; version: number; unchanged?: boolean }
  | { ok: false; conflict: true; message: string; current: { id: string; title: string; content: string; version: number; updated_at: string } };
