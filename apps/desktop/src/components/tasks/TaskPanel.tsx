import { TASK_STATUS_LABELS, WORK_STATUSES, type Task, type TaskStatus } from "@cooper/shared";
import { useState } from "react";
import { deleteTask, updateTask, type TaskEdit } from "../../lib/api";
import { eventText } from "../../lib/events";
import { timeAgo } from "../../lib/format";
import { memberName } from "../../lib/names";
import type { WorkspaceData } from "../../lib/useWorkspace";
import { ConfirmBar, Icon, SourceBadge } from "../ui";
import { RespondButtons } from "./RespondButtons";

const ACCEPTED: TaskStatus[] = ["backlog", "in_progress", "in_review"];

export function TaskPanel({ task, data, me, now, onClose }: { task: Task; data: WorkspaceData; me: string; now: Date; onClose: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const events = data.events.filter((e) => e.task_id === task.id).slice(0, 8);
  const links = data.links.filter((l) => l.task_id === task.id);
  const name = (id: string | null) => memberName(data, id);

  const isOwner = data.members.some((m) => m.user_id === me && m.role === "owner");
  // regras no banco: excluir = dono, autor ou responsável; editar texto = autor ou dono
  const canDelete = isOwner || task.created_by === me || task.assignee_id === me;
  const canEdit = isOwner || task.created_by === me;

  // Eventos de mudança de status são gravados pelo banco (trigger), com a origem certa.
  async function patch(fields: Partial<Task>) {
    setErr(null);
    setErr(await updateTask(task.id, fields));
  }

  async function remove() {
    setErr(null);
    setDeleting(true);
    try {
      const error = await deleteTask(task.id);
      if (error) return setErr(error);
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <aside className="absolute inset-0 z-10 flex flex-col bg-panel" role="dialog" aria-label={`Tarefa #${task.number}`}>
      <header className="flex items-center gap-2 border-b border-line px-2 py-1.5">
        <span className="text-muted">#{task.number}</span>
        <span className="min-w-0 flex-1 truncate font-semibold">{task.title}</span>
        {canEdit && !editing && (
          <HeaderButton label="Editar tarefa" onClick={() => setEditing(true)}>
            <Icon name="edit" size={13} />
          </HeaderButton>
        )}
        {canDelete && (
          <HeaderButton label="Excluir tarefa" danger onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size={13} />
          </HeaderButton>
        )}
        <HeaderButton label="Fechar" onClick={onClose}>
          <Icon name="close" size={13} />
        </HeaderButton>
      </header>
      {confirmDelete && (
        <div className="border-b border-line p-2">
          <ConfirmBar
            text={`Excluir a tarefa #${task.number}? Isso não pode ser desfeito.`}
            confirmLabel="Excluir"
            busy={deleting}
            onConfirm={() => void remove()}
            onCancel={() => setConfirmDelete(false)}
          />
        </div>
      )}
      <div className="flex-1 space-y-2.5 overflow-y-auto p-2.5">
        {editing ? (
          <TaskEditForm task={task} data={data} me={me} onDone={() => setEditing(false)} />
        ) : (
          <>
            <div className="grid grid-cols-[70px_1fr] items-center gap-y-1.5">
              <span className="text-muted">Enviada por</span>
              <span>{task.created_by === me ? "você" : name(task.created_by)}</span>
              <label className="text-muted" htmlFor="st">
                Status
              </label>
              {task.status === "awaiting_acceptance" || task.status === "declined" ? (
                <span className={task.status === "declined" ? "text-warn" : ""}>{TASK_STATUS_LABELS[task.status]}</span>
              ) : (
                <select id="st" value={task.status} onChange={(e) => void patch({ status: e.target.value as TaskStatus })} className="rounded border border-line bg-raised px-1 py-0.5">
                  {WORK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {TASK_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              )}
              <label className="text-muted" htmlFor="as">
                Responsável
              </label>
              <select id="as" value={task.assignee_id ?? ""} onChange={(e) => void patch({ assignee_id: e.target.value || null })} className="rounded border border-line bg-raised px-1 py-0.5">
                <option value="">—</option>
                {data.members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {name(m.user_id)}
                  </option>
                ))}
              </select>
            </div>
            {task.status === "awaiting_acceptance" && task.assignee_id === me && <RespondButtons task={task} />}
            {task.status === "awaiting_acceptance" && task.assignee_id !== me && (
              <p className="text-[10.5px] text-muted">Aguardando {name(task.assignee_id)} aceitar. Trocar o responsável envia um novo convite.</p>
            )}
            {task.status === "declined" && (
              <Block title="Motivo da recusa">
                <p>{task.decline_reason}</p>
                <button type="button" onClick={() => void patch({ status: "awaiting_acceptance" })} className="mt-1 rounded-md border border-line px-2 py-0.5 hover:bg-raised">
                  Reenviar para {name(task.assignee_id)}
                </button>
              </Block>
            )}
            {err && <p className="text-[10.5px] text-danger">{err}</p>}
            {task.prompt && <Block title="Prompt">{task.prompt}</Block>}
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
                  <span className="min-w-0 flex-1 truncate">
                    {name(e.user_id)} · {eventText(e, name)}
                  </span>
                  <SourceBadge source={e.source} />
                </div>
              ))}
            </Block>
          </>
        )}
      </div>
    </aside>
  );
}

const FIELD = "block w-full rounded-md border border-line bg-raised px-2 py-1 leading-snug outline-none placeholder:text-muted focus:border-accent";

/** Editar título, prompt, descrição e critérios. Só manda o que mudou. */
function TaskEditForm({ task, data, me, onDone }: { task: Task; data: WorkspaceData; me: string; onDone: () => void }) {
  const [v, setV] = useState({
    title: task.title,
    prompt: task.prompt ?? "",
    description: task.description ?? "",
    acceptance_criteria: task.acceptance_criteria ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const changes: TaskEdit = {};
  if (v.title.trim() !== task.title) changes.title = v.title.trim();
  for (const k of ["prompt", "description", "acceptance_criteria"] as const) {
    const next = v[k].trim() || null;
    if (next !== (task[k] ?? null)) changes[k] = next;
  }
  const dirty = Object.keys(changes).length > 0;
  const needsReaccept = "prompt" in changes && !!task.assignee_id && task.assignee_id !== me && ACCEPTED.includes(task.status);

  async function save() {
    if (!v.title.trim()) return setErr("O título não pode ficar vazio.");
    if (!dirty) return onDone();
    setBusy(true);
    setErr(null);
    try {
      const error = await updateTask(task.id, changes);
      if (error) return setErr(error);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Labeled label="Título">
        <input value={v.title} onChange={set("title")} maxLength={200} required className={FIELD} />
      </Labeled>
      <Labeled label="Prompt">
        <textarea value={v.prompt} onChange={set("prompt")} maxLength={20000} rows={5} className={`${FIELD} resize-y`} placeholder="O que a IA de quem recebe deve fazer" />
      </Labeled>
      <Labeled label="Descrição">
        <textarea value={v.description} onChange={set("description")} maxLength={5000} rows={2} className={`${FIELD} resize-y`} />
      </Labeled>
      <Labeled label="Critérios de aceite">
        <textarea value={v.acceptance_criteria} onChange={set("acceptance_criteria")} maxLength={5000} rows={2} className={`${FIELD} resize-y`} />
      </Labeled>
      {needsReaccept && (
        <p className="rounded-md bg-warn/10 px-2 py-1 text-[10.5px] leading-snug text-warn">
          Mudar o prompt faz {memberName(data, task.assignee_id)} aceitar a tarefa de novo, porque a IA dela vai executar o texto novo.
        </p>
      )}
      {err && <p className="text-[10.5px] text-danger">{err}</p>}
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onDone} className="rounded-md px-2 py-0.5 text-muted hover:text-text">
          Cancelar
        </button>
        <button disabled={busy || !dirty} className="rounded-md bg-accent px-2.5 py-0.5 font-medium text-white disabled:opacity-40">
          {busy ? "Salvando…" : needsReaccept ? "Salvar e pedir novo aceite" : "Salvar"}
        </button>
      </div>
    </form>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-0.5">
      <span className="text-[10.5px] font-semibold tracking-wide text-muted uppercase">{label}</span>
      {children}
    </label>
  );
}

function HeaderButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-muted ${danger ? "hover:bg-danger/10 hover:text-danger" : "hover:bg-raised hover:text-text"}`}
    >
      {children}
    </button>
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
