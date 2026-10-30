import { isSkillTitle, skillDisplayName, TASK_STATUS_LABELS, type TaskEvent, type TaskStatus } from "@cooper/shared";
import type { IconName } from "../components/ui";

export type EventCategory = "tasks" | "progress" | "context";

export const EVENT_CATEGORY: Record<string, EventCategory> = {
  task_created: "tasks",
  task_sent: "tasks",
  task_edited: "tasks",
  status_changed: "tasks",
  complete_task: "tasks",
  task_deleted: "tasks",
  dependency_done: "tasks",
  pr_update: "tasks",
  task_blocked: "progress",
  task_unblocked: "progress",
  availability_changed: "progress",
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
  /** Sinal entre agentes no início do progresso ("LIBERA #3: …"), mostrado como etiqueta. */
  tag?: { label: string; tone: string };
}

/**
 * Sinais que os agentes põem no começo do report_progress (skill de colaboração):
 * "AGUARDANDO #3: …", "LIBERA #3: …", "BLOQUEADO: …", "CONTRATO: …", "HANDOFF #3 → Ian: …".
 */
const SIGNAL = /^(AGUARDANDO|LIBERA|BLOQUEADO|CONTRATO|HANDOFF)\b\s*(#\d+)?\s*(?:→\s*([^:]+?)\s*(?=:))?\s*:?\s*/i;
const SIGNALS: Record<string, { icon: IconName; tone: string; label: (task: string, to: string) => string }> = {
  AGUARDANDO: { icon: "alert", tone: "text-warn", label: (t) => `Aguardando ${t}`.trim() },
  LIBERA: { icon: "check", tone: "text-run", label: (t) => `Liberou ${t}`.trim() },
  BLOQUEADO: { icon: "alert", tone: "text-danger", label: () => "Bloqueado" },
  CONTRATO: { icon: "book", tone: "text-accent", label: () => "Contrato mudou" },
  HANDOFF: { icon: "users", tone: "text-accent", label: (t, to) => `Passou ${t}${to ? ` para ${to}` : ""}`.trim() },
};

export function progressLine(raw: string): EventLine {
  const m = SIGNAL.exec(raw);
  if (!m) return { icon: "activity", tone: "text-muted", text: raw };
  const s = SIGNALS[m[1]!.toUpperCase()]!;
  return { icon: s.icon, tone: s.tone, text: raw.slice(m[0].length) || raw, tag: { label: s.label(m[2] ?? "", m[3]?.trim() ?? ""), tone: s.tone } };
}

/** pr_update (GitHub): o que mudou no PR ligado à tarefa. */
const PR_CHANGES: Record<string, { tag: string; tone: string }> = {
  opened: { tag: "Aberto", tone: "text-accent" },
  checks_failure: { tag: "CI falhou", tone: "text-danger" },
  checks_success: { tag: "CI passou", tone: "text-run" },
  approved: { tag: "Aprovado", tone: "text-run" },
  changes_requested: { tag: "Mudanças pedidas", tone: "text-warn" },
  merged: { tag: "Merge feito", tone: "text-run" },
  closed: { tag: "Fechado sem merge", tone: "text-muted" },
};

/** set_availability do agente. */
export const AVAILABILITY: Record<string, string> = { available: "Disponível", busy: "Ocupado", near_limit: "Perto do limite", away: "Ausente" };

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
      return { icon: "list", tone: "text-accent", text: `enviou para ${name(String(p.assignee_id))}${p.auto_accepted ? " (aceita automaticamente)" : ""}` };
    case "task_edited": {
      const fields = Array.isArray(p.fields) ? (p.fields as string[]).map((f) => FIELD_LABELS[f] ?? f).join(", ") : undefined;
      return { icon: "edit", tone: p.reaccept ? "text-warn" : "text-accent", text: "editou a tarefa", detail: [fields, p.reaccept ? "pede novo aceite" : ""].filter(Boolean).join(" · ") || undefined };
    }
    case "start_task":
      return { icon: "play", tone: "text-run", text: "começou a tarefa", detail: p.branch ? `em ${String(p.branch)}` : undefined };
    case "report_progress":
      return progressLine(String(p.text ?? "progresso"));
    case "complete_task":
      return { icon: "check", tone: "text-text", text: "concluiu a tarefa", detail: quote(p.summary) };
    case "comment_added":
      return { icon: "edit", tone: "text-accent", text: "comentou", detail: quote(p.text) };
    case "attachment_added":
      return { icon: "plus", tone: "text-accent", text: "anexou um arquivo", detail: String(p.name ?? "") };
    case "attachment_removed":
      return { icon: "trash", tone: "text-muted", text: "apagou um anexo", detail: String(p.name ?? "") };
    case "dependency_done":
      // o evento fica na tarefa que esperava; quem aparece é quem concluiu a dependência
      return p.all_done
        ? { icon: "check", tone: "text-run", text: `concluiu #${String(p.number)} ${String(p.title ?? "")}`, tag: { label: "Liberou", tone: "text-run" } }
        : { icon: "check", tone: "text-muted", text: `concluiu #${String(p.number)} ${String(p.title ?? "")}`, detail: "(ainda falta outra dependência)" };
    case "pr_update": {
      const c = PR_CHANGES[String(p.change)] ?? { tag: String(p.change), tone: "text-muted" };
      return { icon: "branch", tone: c.tone, text: `PR #${String(p.pr)}`, detail: p.title ? String(p.title) : undefined, tag: { label: c.tag, tone: c.tone } };
    }
    case "task_blocked":
      return { icon: "alert", tone: "text-danger", text: String(p.reason ?? ""), tag: { label: "Bloqueado", tone: "text-danger" } };
    case "task_unblocked":
      return { icon: "check", tone: "text-run", text: "desbloqueou a tarefa" };
    case "availability_changed": {
      const label = AVAILABILITY[String(p.status)] ?? String(p.status);
      return { icon: "gauge", tone: p.status === "near_limit" ? "text-warn" : "text-muted", text: p.note ? String(p.note) : "mudou a disponibilidade", tag: { label, tone: p.status === "near_limit" ? "text-warn" : "text-muted" } };
    }
    case "task_deleted":
      return { icon: "trash", tone: "text-danger", text: "apagou a tarefa", detail: `#${String(p.number ?? "?")} ${String(p.title ?? "")}` };
    case "context_updated": {
      const verb = { create: "criou", update: "atualizou", restore: "restaurou", delete: "apagou" }[String(p.action)] ?? "mudou";
      const title = String(p.block_title ?? "");
      const skill = isSkillTitle(title);
      return {
        icon: skill ? "terminal" : "book",
        tone: p.action === "delete" ? "text-danger" : "text-accent",
        text: `${verb} ${skill ? "a skill" : "o contexto"}`,
        detail: skill ? skillDisplayName(title) : title,
      };
    }
    case "status_changed":
      if (p.from_status === "awaiting_acceptance" && to === "backlog") return { icon: "check", tone: "text-muted", text: "aceitou a tarefa" };
      if (to === "declined") return { icon: "close", tone: "text-warn", text: "recusou a tarefa", detail: quote(p.reason) };
      if (p.from_status === "declined" && to === "awaiting_acceptance") return { icon: "list", tone: "text-accent", text: "reenviou a tarefa" };
      if (to === "awaiting_acceptance") return { icon: "list", tone: "text-warn", text: "voltou para aguardando aceite" };
      if (to === "done") return { icon: "check", tone: "text-text", text: "concluiu a tarefa" };
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
  const text = l.tag ? `${l.tag.label}: ${l.text}` : l.text;
  return l.detail ? `${text} ${l.detail}` : text;
};
