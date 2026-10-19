import type { Task } from "@cooper/shared";
import { useState } from "react";
import { memberName } from "../lib/names";
import type { WorkspaceData } from "../lib/useWorkspace";
import { CreateTask } from "./tasks/CreateTask";
import { CLOSED, TaskList } from "./tasks/TaskList";
import { TaskPanel } from "./tasks/TaskPanel";

/** Tarefas aguardando o meu aceite: o widget mostra o contador na aba. */
export const awaitingForMe = (d: WorkspaceData, me: string) => d.tasks.filter((t) => t.assignee_id === me && t.status === "awaiting_acceptance");

type View = "mine" | "theirs" | "nobody";

export function TasksTab({ data, me, now, initialOpenId = null }: { data: WorkspaceData; me: string; now: Date; initialOpenId?: string | null }) {
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [view, setView] = useState<View>(() => {
    const t = data.tasks.find((x) => x.id === initialOpenId);
    return !t || t.assignee_id === me ? "mine" : t.assignee_id ? "theirs" : "nobody";
  });
  const open = data.tasks.find((t) => t.id === openId) ?? null;
  const others = data.members.filter((m) => m.user_id !== me);
  const otherLabel = others.length === 1 ? `Para ${memberName(data, others[0]!.user_id)}` : "Para o outro";

  const lists: Record<View, Task[]> = {
    mine: data.tasks.filter((t) => t.assignee_id === me),
    theirs: data.tasks.filter((t) => t.assignee_id && t.assignee_id !== me),
    nobody: data.tasks.filter((t) => !t.assignee_id),
  };
  const openCount = (l: Task[]) => l.filter((t) => !CLOSED.includes(t.status)).length;
  const views: { id: View; label: string }[] = [
    { id: "mine", label: "Para mim" },
    { id: "theirs", label: otherLabel },
    ...(lists.nobody.length > 0 ? [{ id: "nobody" as const, label: "Sem dono" }] : []),
  ];

  return (
    <div className="relative flex h-full flex-col">
      <CreateTask data={data} me={me} />
      <div role="tablist" aria-label="De quem são as tarefas" className="mx-2.5 mb-2 flex rounded-lg bg-raised p-0.5">
        {views.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
            className={`flex flex-1 items-center justify-center gap-1 truncate rounded-md px-2 py-1 text-[11px] ${view === v.id ? "bg-panel font-semibold shadow-sm" : "text-muted hover:text-text"}`}
          >
            {v.label}
            <span className={`text-[10px] ${view === v.id ? "text-accent" : ""}`}>{openCount(lists[v.id])}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-2.5 pb-2.5">
        <TaskList key={view} tasks={lists[view]} data={data} me={me} onOpen={setOpenId} />
      </div>
      {open && <TaskPanel task={open} data={data} me={me} now={now} onClose={() => setOpenId(null)} />}
    </div>
  );
}
