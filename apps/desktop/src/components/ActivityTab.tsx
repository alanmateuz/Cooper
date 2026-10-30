import { AGENT_LABELS, SOURCE_LABELS, type TaskEvent } from "@cooper/shared";
import { useMemo, useState } from "react";
import { describeEvent, EVENT_CATEGORY } from "../lib/events";
import { memberName } from "../lib/names";
import type { WorkspaceData } from "../lib/useWorkspace";
import { Empty } from "./OtherTabs";
import { Avatar, BrandIcon, Icon } from "./ui";

type Filter = "all" | "tasks" | "progress" | "context";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Tudo" },
  { id: "tasks", label: "Tarefas" },
  { id: "progress", label: "Progresso" },
  { id: "context", label: "Contexto" },
];
/** Eventos seguidos da mesma pessoa, pela mesma origem e na mesma tarefa, em até 15 min, ficam num grupo só. */
const GROUP_GAP_MS = 15 * 60_000;
/** Num grupo longo, mostra os mais recentes e recolhe o resto. */
const GROUP_VISIBLE = 3;
/** Cada uso de ferramenta pelo hook vira um evento: só aparece no filtro Progresso, para não afogar o resto. */
const NOISY = new Set(["post_tool_use"]);

export function ActivityTab({ data, now, onOpenTask }: { data: WorkspaceData; now: Date; onOpenTask: (taskId: string) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const member = (id: string | null) => data.members.find((m) => m.user_id === id);
  const name = (id: string | null) => memberName(data, id, "Alguém");

  const days = useMemo(() => {
    // conclusão pelo MCP grava "complete_task" e "status_changed → done": mostra só o primeiro
    const completed = new Set(data.events.filter((e) => e.type === "complete_task").map((e) => e.task_id));
    const events = data.events.filter(
      (e) =>
        !(e.type === "status_changed" && e.payload.to_status === "done" && completed.has(e.task_id)) &&
        (filter === "all" ? !NOISY.has(e.type) : EVENT_CATEGORY[e.type] === filter),
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
        g.first.task_id === e.task_id &&
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
                {d.groups.map((g) => (
                  <Group key={g.key} group={g} data={data} name={name} member={member} onOpenTask={onOpenTask} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** Um cartão por pessoa e tarefa: quem, com qual agente, em qual tarefa, e o que aconteceu (mais recente primeiro). */
function Group({
  group: g,
  data,
  name,
  member,
  onOpenTask,
}: {
  group: { first: TaskEvent; items: TaskEvent[] };
  data: WorkspaceData;
  name: (id: string | null) => string;
  member: (id: string | null) => WorkspaceData["members"][number] | undefined;
  onOpenTask: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const m = member(g.first.user_id);
  const session = data.sessions.find((s) => s.id === g.first.agent_session_id);
  // eventos lidos do GitHub não têm pessoa: o cartão é do próprio GitHub
  const fromGithub = g.first.source === "github" && !g.first.user_id;
  const origin = g.first.source === "user" || fromGithub ? null : session ? `${AGENT_LABELS[session.agent_kind]} · ${SOURCE_LABELS[g.first.source]}` : SOURCE_LABELS[g.first.source];
  const task = data.tasks.find((t) => t.id === g.first.task_id);
  const hidden = g.items.length - GROUP_VISIBLE;
  const items = expanded || hidden <= 1 ? g.items : g.items.slice(0, GROUP_VISIBLE);
  return (
    <article className="rounded-xl border border-line bg-panel px-2.5 py-2">
      <header className="mb-1 flex items-center gap-2">
        {fromGithub ? (
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
            <BrandIcon brand="github" size={15} />
          </span>
        ) : (
          <Avatar name={m?.profile?.display_name ?? "?"} color={m?.profile?.avatar_color ?? "#64748b"} size={20} />
        )}
        <span className="min-w-0 truncate font-semibold">{fromGithub ? "GitHub" : name(g.first.user_id)}</span>
        {origin && <span className="shrink-0 truncate rounded-full bg-raised px-1.5 py-px text-[10px] text-muted">{origin}</span>}
      </header>
      {task && (
        <button
          type="button"
          onClick={() => onOpenTask(task.id)}
          className="mb-1 ml-7 flex max-w-[calc(100%-1.75rem)] items-center gap-1 rounded-md bg-raised px-1.5 py-px text-[10.5px] text-muted hover:text-text"
          title="Abrir tarefa"
        >
          <span className="tabular-nums">#{task.number}</span>
          <span className="truncate">{task.title}</span>
        </button>
      )}
      {!task && g.first.task_id === null && EVENT_CATEGORY[g.first.type] === "tasks" && g.first.type !== "task_deleted" && (
        <span className="mb-1 ml-7 inline-block rounded-md bg-raised px-1.5 py-px text-[10.5px] text-muted italic">tarefa apagada</span>
      )}
      <ol className="space-y-1 pl-7">
        {items.map((e) => (
          <EventLine key={e.id} e={e} name={name} />
        ))}
      </ol>
      {hidden > 1 && (
        <button type="button" onClick={() => setExpanded(!expanded)} className="mt-1 ml-7 text-[10.5px] text-accent hover:underline">
          {expanded ? "mostrar menos" : `mais ${hidden} ${hidden === 1 ? "evento" : "eventos"}`}
        </button>
      )}
    </article>
  );
}

function EventLine({ e, name }: { e: TaskEvent; name: (id: string | null) => string }) {
  const l = describeEvent(e, name);
  const at = new Date(e.occurred_at);
  return (
    <li className="flex items-start gap-1.5">
      <span className={`mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center ${l.tone}`}>
        <Icon name={l.icon} size={12} />
      </span>
      <div className="min-w-0 flex-1 leading-snug">
        {l.tag && <span className={`mr-1 inline-block rounded border border-current px-1 text-[10px] leading-[14px] font-semibold ${l.tag.tone}`}>{l.tag.label}</span>}
        <span>{l.text}</span>
        {l.detail && <Detail text={l.detail} />}
      </div>
      <time className="shrink-0 pt-px text-[10px] text-muted tabular-nums" dateTime={e.occurred_at} title={at.toLocaleString("pt-BR")}>
        {at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
      </time>
    </li>
  );
}

/** Resumos e comentários podem ter centenas de caracteres: mostra duas linhas e abre ao clicar. */
const LONG = 110;
function Detail({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (text.length <= LONG) return <span className="text-muted"> {text}</span>;
  return (
    <span className="mt-0.5 block text-muted">
      <span className={open ? "whitespace-pre-wrap select-text" : "line-clamp-2"}>{text}</span>
      <button type="button" onClick={() => setOpen(!open)} className="text-[10.5px] text-accent hover:underline">
        {open ? "menos" : "ler tudo"}
      </button>
    </span>
  );
}

function dayLabel(d: Date, now: Date): string {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86_400_000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Ontem";
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" }).replaceAll(".", "");
}
