import { TASK_STATUS_LABELS, TASK_STATUSES, type Task, type TaskStatus } from "@cooper/shared";
import { useState } from "react";
import { memberName } from "../../lib/names";
import type { WorkspaceData } from "../../lib/useWorkspace";
import { Icon } from "../ui";
import { RespondButtons } from "./RespondButtons";

const ORDER = Object.fromEntries(TASK_STATUSES.map((s, i) => [s, i])) as Record<TaskStatus, number>;
export const CLOSED: TaskStatus[] = ["done", "declined"];
const INVITES_SHOWN = 3;

/** Cores de status: só para status que pedem atenção ou mostram progresso. */
const STATUS_CHIP: Record<TaskStatus, string> = {
  awaiting_acceptance: "bg-accent/15 text-accent",
  backlog: "bg-raised text-muted",
  in_progress: "bg-online/15 text-online",
  in_review: "bg-warn/15 text-warn",
  done: "bg-run/15 text-run",
  declined: "bg-warn/15 text-warn",
};

export function StatusChip({ status }: { status: TaskStatus }) {
  return <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] whitespace-nowrap ${STATUS_CHIP[status]}`}>{TASK_STATUS_LABELS[status]}</span>;
}

export function TaskList({ tasks, data, me, onOpen }: { tasks: Task[]; data: WorkspaceData; me: string; onOpen: (id: string) => void }) {
  const [showClosed, setShowClosed] = useState(false);
  const [allInvites, setAllInvites] = useState(false);
  const awaiting = tasks.filter((t) => t.status === "awaiting_acceptance").sort((a, b) => b.number - a.number);
  const active = tasks.filter((t) => t.status !== "awaiting_acceptance" && !CLOSED.includes(t.status)).sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.number - b.number);
  const declined = tasks.filter((t) => t.status === "declined");
  const done = tasks.filter((t) => t.status === "done").sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const shownInvites = allInvites ? awaiting : awaiting.slice(0, INVITES_SHOWN);

  if (tasks.length === 0) return <p className="px-1 pt-6 text-center text-muted">Nenhuma tarefa aqui.</p>;
  return (
    <div className="space-y-3">
      {awaiting.length > 0 && (
        <Group title={awaiting[0]!.assignee_id === me ? "Aguardando seu aceite" : "Aguardando aceite"} count={awaiting.length}>
          {shownInvites.map((t) => (
            <AwaitingCard key={t.id} task={t} data={data} me={me} onOpen={() => onOpen(t.id)} />
          ))}
          {awaiting.length > INVITES_SHOWN && (
            <button type="button" onClick={() => setAllInvites((v) => !v)} className="w-full rounded-md py-1 text-[10.5px] text-accent hover:bg-raised">
              {allInvites ? "mostrar menos" : `mostrar todos (${awaiting.length})`}
            </button>
          )}
        </Group>
      )}
      {declined.length > 0 && (
        <Group title="Recusadas" count={declined.length}>
          {declined.map((t) => (
            <button key={t.id} type="button" onClick={() => onOpen(t.id)} className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-raised">
              <div className="flex items-baseline gap-1.5">
                <span className="shrink-0 text-[10.5px] text-muted tabular-nums">#{t.number}</span>
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <StatusChip status={t.status} />
              </div>
              {t.decline_reason && <p className="truncate pl-6 text-[10.5px] text-muted">“{t.decline_reason}”</p>}
            </button>
          ))}
        </Group>
      )}
      {active.length > 0 && (
        <Group title="Em aberto" count={active.length}>
          {active.map((t) => (
            <TaskRow key={t.id} task={t} onOpen={() => onOpen(t.id)} />
          ))}
        </Group>
      )}
      {done.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowClosed((v) => !v)} className="flex items-center gap-1 px-1 text-[10.5px] text-muted hover:text-text">
            <span className={`transition-transform ${showClosed ? "rotate-90" : ""}`}>
              <Icon name="chevron" size={10} />
            </span>
            Concluídas {done.length}
          </button>
          {showClosed && <div className="mt-1">{done.map((t) => <TaskRow key={t.id} task={t} onOpen={() => onOpen(t.id)} />)}</div>}
        </div>
      )}
    </div>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 flex items-center gap-1.5 px-1 text-[10.5px] font-semibold tracking-wide text-muted uppercase">
        {title} <span className="font-normal">{count}</span>
      </h2>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function TaskRow({ task, onOpen }: { task: Task; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-raised">
      <span className="w-7 shrink-0 text-[10.5px] text-muted tabular-nums">#{task.number}</span>
      <span className={`min-w-0 flex-1 truncate ${task.status === "done" ? "text-muted line-through" : ""}`}>{task.title}</span>
      <StatusChip status={task.status} />
    </button>
  );
}

/** Convite de tarefa: para mim, com Aceitar/Recusar; para o outro, só o aviso. */
function AwaitingCard({ task, data, me, onOpen }: { task: Task; data: WorkspaceData; me: string; onOpen: () => void }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const forMe = task.assignee_id === me;
  return (
    <article className="rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-2">
      <button type="button" onClick={onOpen} className="flex w-full items-baseline gap-1.5 text-left">
        <span className="shrink-0 text-[10.5px] text-muted tabular-nums">#{task.number}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
      </button>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[10.5px] text-muted">{forMe ? `de ${memberName(data, task.created_by)}` : `para ${memberName(data, task.assignee_id)}`}</span>
        {task.prompt && (
          <button type="button" onClick={() => setShowPrompt((v) => !v)} className="text-[10.5px] text-accent hover:underline">
            {showPrompt ? "ocultar prompt" : "ver prompt"}
          </button>
        )}
        {forMe && <RespondButtons task={task} inline />}
      </div>
      {showPrompt && <p className="mt-1.5 max-h-40 overflow-y-auto rounded-md bg-panel px-2 py-1.5 leading-snug whitespace-pre-wrap select-text">{task.prompt}</p>}
    </article>
  );
}
