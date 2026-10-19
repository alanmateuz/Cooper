import { AGENT_LABELS, SOURCE_LABELS, TASK_STATUS_LABELS, type TaskEvent, type TaskStatus } from "@cooper/shared";
import { useMemo, useState } from "react";
import type { WorkspaceData } from "../lib/useWorkspace";
import { Empty } from "./OtherTabs";
import { Avatar, Icon } from "./ui";

type Filter = "all" | "tasks" | "progress" | "context";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Tudo" },
  { id: "tasks", label: "Tarefas" },
  { id: "progress", label: "Progresso" },
  { id: "context", label: "Contexto" },
];
const CATEGORY: Record<string, Filter> = {
  task_created: "tasks",
  task_sent: "tasks",
  status_changed: "tasks",
  complete_task: "tasks",
  task_deleted: "tasks",
  start_task: "progress",
  report_progress: "progress",
  git_snapshot: "progress",
  post_tool_use: "progress",
  context_updated: "context",
};

type IconName = Parameters<typeof Icon>[0]["name"];
interface Line {
  icon: IconName;
  tone: string;
  text: string;
  detail?: string;
}

/** Eventos seguidos da mesma pessoa, pela mesma origem, em até 15 min, ficam num grupo só. */
const GROUP_GAP_MS = 15 * 60_000;

export function ActivityTab({ data, now, onOpenTask }: { data: WorkspaceData; now: Date; onOpenTask: (taskId: string) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const member = (id: string | null) => data.members.find((m) => m.user_id === id);
  const name = (id: string | null) => member(id)?.profile?.display_name.replace(/\s*\(.*\)/, "") ?? "Alguém";

  const days = useMemo(() => {
    // conclusão pelo MCP grava "complete_task" e "status_changed → done": mostra só o primeiro
    const completed = new Set(data.events.filter((e) => e.type === "complete_task").map((e) => e.task_id));
    const events = data.events.filter(
      (e) =>
        !(e.type === "status_changed" && e.payload.to_status === "done" && completed.has(e.task_id)) &&
        (filter === "all" || CATEGORY[e.type] === filter),
    );
    const out: { day: string; groups: { key: string; first: TaskEvent; items: TaskEvent[] }[] }[] = [];
    for (const e of events) {
      const at = new Date(e.occurred_at);
      const day = dayLabel(at, now);
      let d = out[out.length - 1];
      if (!d || d.day !== day) out.push((d = { day, groups: [] }));
      const g = d.groups[d.groups.length - 1];
      const last = g?.items[g.items.length - 1];
      const sameGroup =
        g &&
        last &&
        g.first.user_id === e.user_id &&
        g.first.source === e.source &&
        g.first.agent_session_id === e.agent_session_id &&
        new Date(last.occurred_at).getTime() - at.getTime() < GROUP_GAP_MS;
      if (sameGroup) g.items.push(e);
      else d.groups.push({ key: e.id, first: e, items: [e] });
    }
    return out;
  }, [data.events, filter, now]);

  return (
    <div className="flex h-full flex-col">
      <div role="tablist" aria-label="Filtrar atividade" className="mx-2.5 mt-2.5 mb-1 flex rounded-lg bg-raised p-0.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`flex-1 rounded-md px-1.5 py-1 text-[11px] ${filter === f.id ? "bg-panel font-semibold shadow-sm" : "text-muted hover:text-text"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {days.length === 0 ? (
        <Empty>{filter === "all" ? "Nenhum evento ainda." : "Nada deste tipo por enquanto."}</Empty>
      ) : (
        <div className="flex-1 overflow-y-auto px-2.5 pb-2.5">
          {days.map((d) => (
            <section key={d.day}>
              <h2 className="sticky top-0 z-[1] bg-bg pt-2 pb-1 text-[10.5px] font-semibold tracking-wide text-muted uppercase">{d.day}</h2>
              <div className="space-y-1.5">
                {d.groups.map((g) => {
                  const m = member(g.first.user_id);
                  const session = data.sessions.find((s) => s.id === g.first.agent_session_id);
                  const origin = g.first.source === "user" ? null : session ? `${AGENT_LABELS[session.agent_kind]} · ${SOURCE_LABELS[g.first.source]}` : SOURCE_LABELS[g.first.source];
                  return (
                    <article key={g.key} className="rounded-xl border border-line bg-panel px-2.5 py-2">
                      <header className="mb-1 flex items-center gap-2">
                        <Avatar name={m?.profile?.display_name ?? "?"} color={m?.profile?.avatar_color ?? "#64748b"} size={20} />
                        <span className="min-w-0 truncate font-semibold">{name(g.first.user_id)}</span>
                        {origin && <span className="shrink-0 truncate rounded-full bg-raised px-1.5 py-px text-[10px] text-muted">{origin}</span>}
                      </header>
                      <ol className="space-y-1 pl-7">
                        {g.items.map((e) => (
                          <EventLine key={e.id} e={e} data={data} name={name} onOpenTask={onOpenTask} />
                        ))}
                      </ol>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function EventLine({ e, data, name, onOpenTask }: { e: TaskEvent; data: WorkspaceData; name: (id: string | null) => string; onOpenTask: (id: string) => void }) {
  const l = describe(e, name);
  const task = data.tasks.find((t) => t.id === e.task_id);
  const at = new Date(e.occurred_at);
  return (
    <li className="flex items-start gap-1.5">
      <span className={`mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center ${l.tone}`}>
        <Icon name={l.icon} size={12} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="leading-snug">
          {l.text}
          {l.detail && <span className="text-muted"> {l.detail}</span>}
        </p>
        {!task && !e.task_id && CATEGORY[e.type] === "tasks" && e.type !== "task_deleted" && (
          <span className="mt-0.5 inline-block rounded-md bg-raised px-1.5 py-px text-[10.5px] text-muted italic">tarefa apagada</span>
        )}
        {task && (
          <button
            type="button"
            onClick={() => onOpenTask(task.id)}
            className="mt-0.5 flex max-w-full items-center gap-1 rounded-md bg-raised px-1.5 py-px text-[10.5px] text-muted hover:text-text"
            title="Abrir tarefa"
          >
            <span className="tabular-nums">#{task.number}</span>
            <span className="truncate">{task.title}</span>
          </button>
        )}
      </div>
      <time className="shrink-0 pt-px text-[10px] text-muted tabular-nums" dateTime={e.occurred_at} title={at.toLocaleString("pt-BR")}>
        {at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
      </time>
    </li>
  );
}

const quote = (v: unknown) => (v ? `“${String(v)}”` : undefined);

function describe(e: TaskEvent, name: (id: string | null) => string): Line {
  const p = e.payload;
  const to = p.to_status as TaskStatus | undefined;
  switch (e.type) {
    case "task_created":
      return p.assignee_id && to === "awaiting_acceptance"
        ? { icon: "plus", tone: "text-accent", text: `criou e enviou para ${name(String(p.assignee_id))}` }
        : { icon: "plus", tone: "text-accent", text: "criou a tarefa" };
    case "task_sent":
      return { icon: "list", tone: "text-accent", text: `enviou para ${name(String(p.assignee_id))}` };
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

function dayLabel(d: Date, now: Date): string {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86_400_000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Ontem";
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" }).replaceAll(".", "");
}
