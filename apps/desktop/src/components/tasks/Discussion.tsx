import { TASK_STATUS_LABELS, type Task } from "@cooper/shared";
import { useEffect, useState } from "react";
import { friendlyError } from "../../lib/errors";
import { timeAgo } from "../../lib/format";
import { memberName } from "../../lib/names";
import { supabase } from "../../lib/supabase";
import type { WorkspaceData } from "../../lib/useWorkspace";
import { SourceBadge } from "../ui";

export const PRIORITY_LABELS = ["Nenhuma", "Baixa", "Média", "Alta", "Urgente"] as const;
export const PRIORITY_CHIP = ["", "bg-raised text-muted", "bg-online/15 text-online", "bg-warn/15 text-warn", "bg-danger/15 text-danger"] as const;

/** "vence hoje", "atrasada 2 d", "em 3 d" — prazo em relação a hoje (data local). */
export function dueLabel(due: string, now: Date): { text: string; late: boolean } {
  const [y, m, d] = due.split("-").map(Number);
  const target = new Date(y!, m! - 1, d!);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { text: `atrasada ${-days} d`, late: true };
  if (days === 0) return { text: "vence hoje", late: false };
  if (days === 1) return { text: "vence amanhã", late: false };
  return { text: `em ${days} d`, late: false };
}

/** Subtarefas: progresso, lista e criação rápida (para mim; a IA coordenadora divide para outros pelo MCP). */
export function Subtasks({ task, data, me, onOpen }: { task: Task; data: WorkspaceData; me: string; onOpen?: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const subs = data.tasks.filter((t) => t.parent_id === task.id).sort((a, b) => a.number - b.number);
  const parent = task.parent_id ? data.tasks.find((t) => t.id === task.parent_id) : null;
  const done = subs.filter((s) => s.status === "done").length;

  if (parent) {
    return (
      <p className="text-[10.5px] text-muted">
        Subtarefa de{" "}
        <button type="button" onClick={() => onOpen?.(parent.id)} className="text-accent hover:underline">
          #{parent.number} {parent.title}
        </button>
      </p>
    );
  }

  async function add() {
    const t = title.trim();
    if (!t) return;
    setErr(null);
    const { error } = await supabase.from("tasks").insert({ workspace_id: task.workspace_id, title: t, parent_id: task.id, assignee_id: me, created_by: me, priority: task.priority });
    if (error) setErr(friendlyError(error));
    else setTitle("");
  }

  return (
    <section>
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-[10.5px] font-semibold tracking-wide text-muted uppercase">Subtarefas</h3>
        {subs.length > 0 && (
          <span className="flex flex-1 items-center gap-1.5 text-[10px] text-muted">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-raised">
              <span className="block h-full rounded-full bg-run transition-[width] duration-500" style={{ width: `${(done / subs.length) * 100}%` }} />
            </span>
            {done}/{subs.length}
          </span>
        )}
      </div>
      {subs.length > 0 && (
        <ul className="mb-1 space-y-0.5">
          {subs.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => onOpen?.(s.id)} className="anim-in flex w-full items-baseline gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-raised">
                <span className="w-7 shrink-0 text-[10px] text-muted tabular-nums">#{s.number}</span>
                <span className={`min-w-0 flex-1 truncate ${s.status === "done" ? "text-muted line-through" : ""}`}>{s.title}</span>
                <span className="shrink-0 text-[10px] text-muted">{memberName(data, s.assignee_id)} · {TASK_STATUS_LABELS[s.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Nova subtarefa…" aria-label="Nova subtarefa" className="min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-1 outline-none focus:border-accent" />
        <button disabled={!title.trim()} className="rounded-md border border-line px-2 text-[10.5px] hover:bg-raised disabled:opacity-40">Criar</button>
      </form>
      {subs.length > 0 && <p className="mt-1 text-[10px] text-muted">Quando todas forem concluídas, esta tarefa vai para Em revisão.</p>}
      {err && <p className="mt-1 text-[10.5px] text-danger">{err}</p>}
    </section>
  );
}

interface Comment {
  id: string;
  author_id: string;
  source: "user" | "agent_declared";
  body: string;
  created_at: string;
}

/** Comentários da tarefa (pessoas e agentes). Recarrega quando chega um evento de comentário (Realtime). */
export function Comments({ task, data, me, now }: { task: Task; data: WorkspaceData; me: string; now: Date }) {
  const [items, setItems] = useState<Comment[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const changes = data.events.filter((e) => e.task_id === task.id && e.type === "comment_added").length;

  useEffect(() => {
    void supabase
      .from("task_comments")
      .select("id,author_id,source,body,created_at")
      .eq("task_id", task.id)
      .order("created_at")
      .limit(100)
      .then(({ data: rows }) => setItems((rows ?? []) as Comment[]));
  }, [task.id, changes]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setErr(null);
    const { data: row, error } = await supabase
      .from("task_comments")
      .insert({ workspace_id: task.workspace_id, task_id: task.id, author_id: me, body })
      .select("id,author_id,source,body,created_at")
      .single();
    setBusy(false);
    if (error) return setErr(friendlyError(error));
    setItems((xs) => (xs.some((x) => x.id === row.id) ? xs : [...xs, row as Comment]));
    setText("");
  }

  async function remove(id: string) {
    const { error } = await supabase.from("task_comments").delete().eq("id", id);
    if (error) setErr(friendlyError(error));
    else setItems((xs) => xs.filter((x) => x.id !== id));
  }

  return (
    <section>
      <h3 className="mb-1 text-[10.5px] font-semibold tracking-wide text-muted uppercase">Comentários {items.length > 0 && items.length}</h3>
      {items.length === 0 && <p className="mb-1 text-[10.5px] text-muted">Nenhum comentário. Combinados e bloqueios ficam aqui, para as pessoas e as IAs.</p>}
      <ul className="mb-1.5 space-y-1.5">
        {items.map((c) => (
          <li key={c.id} className="anim-in group rounded-lg bg-raised px-2 py-1.5">
            <div className="flex items-center gap-1.5 text-[10px] text-muted">
              <span className="font-medium text-text">{memberName(data, c.author_id)}</span>
              {c.source === "agent_declared" && <SourceBadge source="agent_declared" />}
              <span title={new Date(c.created_at).toLocaleString("pt-BR")}>{timeAgo(c.created_at, now)}</span>
              {c.author_id === me && c.source === "user" && (
                <button type="button" onClick={() => void remove(c.id)} className="ml-auto opacity-0 group-hover:opacity-100 hover:text-danger" aria-label="Apagar comentário">
                  apagar
                </button>
              )}
            </div>
            <p className="mt-0.5 leading-snug whitespace-pre-wrap select-text">{c.body}</p>
          </li>
        ))}
      </ul>
      <form
        className="space-y-1"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
          }}
          maxLength={2000}
          rows={2}
          placeholder="Escreva um comentário (Ctrl+Enter envia)"
          aria-label="Novo comentário"
          className="block w-full resize-y rounded-md border border-line bg-raised px-2 py-1 leading-snug outline-none focus:border-accent"
        />
        <div className="flex justify-end">
          <button disabled={busy || !text.trim()} className="rounded-md bg-accent px-2 py-0.5 text-[11px] text-white disabled:opacity-40">
            Enviar comentário
          </button>
        </div>
      </form>
      {err && <p className="text-[10.5px] text-danger">{err}</p>}
    </section>
  );
}
