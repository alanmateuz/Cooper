import { TASK_STATUS_LABELS, type TaskEvent, type TaskStatus } from "@cooper/shared";
import type { IconName } from "../components/ui";

export type EventCategory = "tasks" | "progress" | "context";

export const EVENT_CATEGORY: Record<string, EventCategory> = {
  task_created: "tasks",
  task_sent: "tasks",
  task_edited: "tasks",
  status_changed: "tasks",
  complete_task: "tasks",
  task_deleted: "tasks",
  start_task: "progress",
  report_progress: "progress",
  git_snapshot: "progress",
  post_tool_use: "progress",
  context_updated: "context",
};

export interface EventLine {
  icon: IconName;
  /** classe de cor do ícone */
  tone: string;
  text: string;
  detail?: string;
}

const FIELD_LABELS: Record<string, string> = { title: "título", prompt: "prompt", description: "descrição", acceptance_criteria: "critérios" };
const quote = (v: unknown) => (v ? `“${String(v)}”` : undefined);

/** Uma linha legível por evento. Fonte única para a aba Atividade e o painel da tarefa. */
export function describeEvent(e: Pick<TaskEvent, "type" | "payload">, name: (id: string | null) => string): EventLine {
  const p = e.payload as Record<string, unknown>;
  const to = p.to_status as TaskStatus | undefined;
  switch (e.type) {
    case "task_created":
      return p.assignee_id && to === "awaiting_acceptance"
        ? { icon: "plus", tone: "text-accent", text: `criou e enviou para ${name(String(p.assignee_id))}` }
        : { icon: "plus", tone: "text-accent", text: "criou a tarefa" };
    case "task_sent":
      return { icon: "list", tone: "text-accent", text: `enviou para ${name(String(p.assignee_id))}` };
    case "task_edited": {
      const fields = Array.isArray(p.fields) ? (p.fields as string[]).map((f) => FIELD_LABELS[f] ?? f).join(", ") : undefined;
      return { icon: "edit", tone: p.reaccept ? "text-warn" : "text-accent", text: "editou a tarefa", detail: [fields, p.reaccept ? "pede novo aceite" : ""].filter(Boolean).join(" · ") || undefined };
    }
    case "start_task":
      return { icon: "play", tone: "text-online", text: "começou a tarefa", detail: p.branch ? `em ${String(p.branch)}` : undefined };
    case "report_progress":
      return { icon: "activity", tone: "text-muted", text: String(p.text ?? "progresso") };
    case "complete_task":
      return { icon: "check", tone: "text-run", text: "concluiu a tarefa", detail: quote(p.summary) };
    case "task_deleted":
      return { icon: "trash", tone: "text-danger", text: "apagou a tarefa", detail: `#${String(p.number ?? "?")} ${String(p.title ?? "")}` };
    case "context_updated": {
      const verb = { create: "criou", update: "atualizou", restore: "restaurou", delete: "apagou" }[String(p.action)] ?? "mudou";
      return { icon: "book", tone: p.action === "delete" ? "text-danger" : "text-accent", text: `${verb} o bloco`, detail: String(p.block_title ?? "") };
    }
    case "status_changed":
      if (p.from_status === "awaiting_acceptance" && to === "backlog") return { icon: "check", tone: "text-online", text: "aceitou a tarefa" };
      if (to === "declined") return { icon: "close", tone: "text-warn", text: "recusou a tarefa", detail: quote(p.reason) };
      if (p.from_status === "declined" && to === "awaiting_acceptance") return { icon: "list", tone: "text-accent", text: "reenviou a tarefa" };
      if (to === "awaiting_acceptance") return { icon: "list", tone: "text-warn", text: "voltou para aguardando aceite" };
      if (to === "done") return { icon: "check", tone: "text-run", text: "concluiu a tarefa" };
      return { icon: "chevron", tone: "text-muted", text: `moveu para ${TASK_STATUS_LABELS[to!] ?? to}` };
    case "git_snapshot":
      return { icon: "branch", tone: "text-muted", text: `git: ${String(p.branch ?? "?")}`, detail: p.commit ? `@ ${String(p.commit)}` : undefined };
    case "post_tool_use":
      return { icon: "activity", tone: "text-muted", text: `usou ${String(p.tool_name ?? "uma ferramenta")}` };
    default:
      return { icon: "activity", tone: "text-muted", text: e.type.replaceAll("_", " ") };
  }
}

/** Mesma descrição numa linha só (painel da tarefa). */
export const eventText = (e: Pick<TaskEvent, "type" | "payload">, name: (id: string | null) => string) => {
  const l = describeEvent(e, name);
  return l.detail ? `${l.text} ${l.detail}` : l.text;
};
