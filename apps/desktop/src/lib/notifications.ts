import { AGENT_LABELS, viewsFromRows, type Task, type TaskEvent } from "@cooper/shared";
import { useEffect, useRef, useState } from "react";
import { pref, setPref } from "./format";
import { memberFirstName } from "./names";
import { playChime } from "./sound";
import type { WorkspaceData } from "./useWorkspace";

/** Limite de uso (5 h ou semana) a partir do qual o time é avisado. */
export const CRITICAL_USAGE_PCT = 90;
const MAX_ITEMS = 30;

export type NotificationKind = "task_received" | "task_done" | "task_accepted" | "task_declined" | "usage_critical";

export interface CooperNotification {
  id: string;
  kind: NotificationKind;
  /** ms desde a época */
  at: number;
  text: string;
  detail?: string;
  taskId?: string;
}

const firstName = (d: WorkspaceData, id: string | null) => memberFirstName(d, id);

function fromEvent(e: TaskEvent, task: Task | undefined, d: WorkspaceData, me: string): Omit<CooperNotification, "id" | "at"> | null {
  if (!task || e.user_id === me) return null;
  const p = e.payload;
  const who = firstName(d, e.user_id);
  const label = `#${task.number} ${task.title}`;
  const to = p.to_status;
  const received = { kind: "task_received" as const, text: `${who} te enviou uma tarefa`, detail: label, taskId: task.id };
  if (e.type === "task_created" && p.assignee_id === me && to === "awaiting_acceptance") return received;
  if (e.type === "task_sent" && p.assignee_id === me) return received;
  // prompt mudou numa tarefa que eu já tinha aceitado: preciso aceitar de novo
  if (e.type === "task_edited" && p.reaccept && task.assignee_id === me)
    return { ...received, text: `${who} mudou o prompt de uma tarefa`, detail: `${label} · aceite de novo para continuar` };
  if (e.type !== "status_changed") return null;
  if (p.from_status === "declined" && to === "awaiting_acceptance" && task.assignee_id === me) return { ...received, text: `${who} reenviou uma tarefa` };
  if (to === "done") return { kind: "task_done", text: `${who} concluiu uma tarefa`, detail: label, taskId: task.id };
  if (task.created_by !== me) return null;
  if (p.from_status === "awaiting_acceptance" && to === "backlog") return { kind: "task_accepted", text: `${who} aceitou sua tarefa`, detail: label, taskId: task.id };
  if (to === "declined")
    return { kind: "task_declined", text: `${who} recusou sua tarefa`, detail: p.reason ? `${label}: “${String(p.reason)}”` : label, taskId: task.id };
  return null;
}

/**
 * Notificações do widget, derivadas do que já chega em tempo real: eventos de tarefa e uso de IA do time.
 * Não há tabela própria; "lida" é só um horário guardado nesta máquina.
 */
export function buildNotifications(d: WorkspaceData, me: string, today: string, now: Date, usageAlerts: boolean): CooperNotification[] {
  const items: CooperNotification[] = [];
  const seenTask = new Set<string>();
  for (const e of d.events) {
    const task = d.tasks.find((t) => t.id === e.task_id);
    const n = fromEvent(e, task, d, me);
    if (!n) continue;
    // conclusão pelo MCP gera dois eventos; vale o mais recente por tarefa e tipo
    const key = `${n.kind}:${n.taskId}`;
    if (seenTask.has(key)) continue;
    seenTask.add(key);
    items.push({ ...n, id: `ev:${e.id}`, at: Date.parse(e.occurred_at) });
  }

  if (usageAlerts) {
    for (const m of d.members) {
      if (m.user_id === me) continue;
      for (const u of viewsFromRows(d.usage.filter((r) => r.user_id === m.user_id), today, now)) {
        for (const [win, label] of [["primary", "de 5 h"], ["secondary", "da semana"]] as const) {
          const l = u[win];
          if (!l || l.pct < CRITICAL_USAGE_PCT) continue;
          items.push({
            id: `usage:${m.user_id}:${u.agent}:${win}:${l.resetsAt.getTime()}`,
            kind: "usage_critical",
            at: (u.limitsObservedAt ?? now).getTime(),
            text: `${firstName(d, m.user_id)} está com ${Math.round(l.pct)}% do limite ${label}`,
            detail: `${AGENT_LABELS[u.agent]} · reinicia ${l.resetsAt.toLocaleString("pt-BR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`,
          });
        }
      }
    }
  }

  return items.sort((a, b) => b.at - a.at).slice(0, MAX_ITEMS);
}

const SEEN_PREF = "notifSeen";
const SEEN_MAX = 200;

/**
 * Lidas/não lidas e o alerta sonoro. "Lida" é por id, guardado nesta máquina; assim um aviso de uso
 * que continua alto não volta a contar como novo. Na primeira carga nada toca (é o histórico) e, se for
 * a primeira vez nesta máquina, tudo o que já existe nasce lido. Depois, cada notificação nova toca uma vez.
 */
export function useNotificationState(items: CooperNotification[], ready: boolean, sound: boolean) {
  const [seen, setSeen] = useState<string[] | null>(() => pref<string[] | null>(SEEN_PREF, null));
  const known = useRef<Set<string> | null>(null);

  const save = (ids: string[]) => {
    const next = ids.slice(-SEEN_MAX);
    setSeen(next);
    setPref(SEEN_PREF, next);
  };

  useEffect(() => {
    if (!ready) return;
    if (known.current === null) {
      known.current = new Set(items.map((i) => i.id));
      if (seen === null) save(items.map((i) => i.id));
      return;
    }
    const fresh = items.filter((i) => !known.current!.has(i.id));
    for (const i of fresh) known.current.add(i.id);
    if (sound && fresh.length > 0) playChime(fresh.some((i) => i.kind === "usage_critical") ? "critical" : "normal");
    // dependências omitidas de propósito: só reage a itens novos, não a cada render
  }, [items, ready, sound]);

  const seenSet = new Set(seen ?? []);
  const isUnread = (n: CooperNotification) => !seenSet.has(n.id);
  const unread = items.filter(isUnread).length;
  const markSeen = () => save([...(seen ?? []).filter((id) => !items.some((i) => i.id === id)), ...items.map((i) => i.id)]);
  return { unread, isUnread, markSeen };
}
