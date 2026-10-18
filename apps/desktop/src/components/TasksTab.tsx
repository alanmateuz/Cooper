import {
  createTaskInputSchema,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type Task,
  type TaskStatus,
} from "@cooper/shared";
import { useState } from "react";
import { timeAgo } from "../lib/format";
import { supabase } from "../lib/supabase";
import type { WorkspaceData } from "../lib/useWorkspace";
import { Icon, SourceBadge } from "./ui";

export function TasksTab({ data, me, now }: { data: WorkspaceData; me: string; now: Date }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<TaskStatus, boolean>>({ backlog: false, in_progress: false, in_review: false, done: true });
  const ws = data.workspace!;
  const open = data.tasks.find((t) => t.id === openId) ?? null;

  async function create() {
    const parsed = createTaskInputSchema.safeParse({ workspace_id: ws.id, title });
    if (!parsed.success) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.from("tasks").insert({ ...parsed.data, created_by: me });
    setBusy(false);
    if (error) setErr(error.message);
    else setTitle("");
  }

  return (
    <div className="relative flex h-full flex-col">
      <form
        className="flex gap-1.5 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="Nova tarefa… (Enter)"
          className="min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-1 outline-none placeholder:text-muted focus:border-accent"
        />
        <button disabled={busy || !title.trim()} className="rounded-md bg-accent px-2 text-white disabled:opacity-40" aria-label="Criar tarefa">
          <Icon name="plus" size={13} />
        </button>
      </form>
      {err && <p className="px-2 pb-1 text-[10.5px] text-red-400">{err}</p>}

      <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-2">
        {TASK_STATUSES.map((st) => {
          const list = data.tasks.filter((t) => t.status === st);
          return (
            <section key={st}>
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [st]: !c[st] }))}
                className="flex w-full items-center gap-1 py-1 text-[10.5px] font-semibold tracking-wide text-muted uppercase"
              >
                <span className={`transition-transform ${collapsed[st] ? "" : "rotate-90"}`}>
                  <Icon name="chevron" size={10} />
                </span>
                {TASK_STATUS_LABELS[st]} <span className="font-normal">{list.length}</span>
              </button>
              {!collapsed[st] &&
                list.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setOpenId(t.id)}
                    className="flex w-full items-baseline gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-raised"
                  >
                    <span className="shrink-0 text-muted">#{t.number}</span>
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <span className="shrink-0 text-[10px] text-muted">{assigneeName(data, t)}</span>
                  </button>
                ))}
            </section>
          );
        })}
      </div>

      {open && <TaskPanel task={open} data={data} me={me} now={now} onClose={() => setOpenId(null)} />}
    </div>
  );
}

const assigneeName = (d: WorkspaceData, t: Task) =>
  d.members.find((m) => m.user_id === t.assignee_id)?.profile?.display_name.replace(/\s*\(.*\)/, "") ?? "";

function TaskPanel({ task, data, me, now, onClose }: { task: Task; data: WorkspaceData; me: string; now: Date; onClose: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const events = data.events.filter((e) => e.task_id === task.id).slice(0, 8);
  const links = data.links.filter((l) => l.task_id === task.id);

  async function patch(fields: Partial<Task>) {
    setErr(null);
    const { error } = await supabase.from("tasks").update(fields).eq("id", task.id);
    if (error) return setErr(error.message);
    if (fields.status && fields.status !== task.status) {
      await supabase.from("task_events").insert({
        workspace_id: task.workspace_id,
        task_id: task.id,
        user_id: me,
        source: "user",
        type: "status_changed",
        payload: { from_status: task.status, to_status: fields.status },
      });
    }
  }

  return (
    <aside className="absolute inset-0 z-10 flex flex-col bg-panel" role="dialog" aria-label={`Tarefa #${task.number}`}>
      <header className="flex items-center gap-2 border-b border-line px-2 py-1.5">
        <span className="text-muted">#{task.number}</span>
        <span className="min-w-0 flex-1 truncate font-semibold">{task.title}</span>
        <button type="button" onClick={onClose} aria-label="Fechar" className="text-muted hover:text-text">
          <Icon name="close" size={13} />
        </button>
      </header>
      <div className="flex-1 space-y-2.5 overflow-y-auto p-2.5">
        <div className="grid grid-cols-[70px_1fr] items-center gap-y-1.5">
          <label className="text-muted" htmlFor="st">Status</label>
          <select id="st" value={task.status} onChange={(e) => void patch({ status: e.target.value as TaskStatus })} className="rounded border border-line bg-raised px-1 py-0.5">
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>
            ))}
          </select>
          <label className="text-muted" htmlFor="as">Responsável</label>
          <select
            id="as"
            value={task.assignee_id ?? ""}
            onChange={(e) => void patch({ assignee_id: e.target.value || null })}
            className="rounded border border-line bg-raised px-1 py-0.5"
          >
            <option value="">—</option>
            {data.members.map((m) => (
              <option key={m.user_id} value={m.user_id}>{m.profile?.display_name ?? m.user_id.slice(0, 6)}</option>
            ))}
          </select>
        </div>
        {err && <p className="text-[10.5px] text-red-400">{err}</p>}
        {task.description && <Block title="Descrição">{task.description}</Block>}
        {task.acceptance_criteria && <Block title="Critérios de aceite">{task.acceptance_criteria}</Block>}
        {links.length > 0 && (
          <Block title="Vínculos">
            {links.map((l) => (
              <div key={l.id} className="flex items-center gap-1.5">
                <span className="text-muted">{l.kind}</span> <span className="truncate">{l.ref}</span> <SourceBadge source={l.source} />
              </div>
            ))}
          </Block>
        )}
        <Block title="Eventos recentes">
          {events.length === 0 && <span className="text-muted">nenhum</span>}
          {events.map((e) => (
            <div key={e.id} className="flex items-center gap-1.5">
              <span className="w-14 shrink-0 text-[10px] text-muted">{timeAgo(e.occurred_at, now)}</span>
              <span className="min-w-0 flex-1 truncate">{e.payload.text ?? e.type}</span>
              <SourceBadge source={e.source} />
            </div>
          ))}
        </Block>
      </div>
    </aside>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-0.5 text-[10.5px] font-semibold tracking-wide text-muted uppercase">{title}</h3>
      <div className="space-y-0.5 leading-snug whitespace-pre-wrap">{children}</div>
    </section>
  );
}
