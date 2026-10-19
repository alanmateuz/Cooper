import {
  createTaskInputSchema,
  declineReasonSchema,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  WORK_STATUSES,
  type Task,
  type TaskStatus,
} from "@cooper/shared";
import { useState } from "react";
import { timeAgo } from "../lib/format";
import { supabase } from "../lib/supabase";
import type { WorkspaceData } from "../lib/useWorkspace";
import { Icon, SourceBadge } from "./ui";

type Data = WorkspaceData;
const ORDER = Object.fromEntries(TASK_STATUSES.map((s, i) => [s, i])) as Record<TaskStatus, number>;
const CLOSED: TaskStatus[] = ["done", "declined"];

const shortName = (d: Data, id: string | null) =>
  d.members.find((m) => m.user_id === id)?.profile?.display_name.replace(/\s*\(.*\)/, "") ?? "—";

/** Tarefas aguardando o meu aceite: o widget mostra o contador na aba. */
export const awaitingForMe = (d: Data, me: string) => d.tasks.filter((t) => t.assignee_id === me && t.status === "awaiting_acceptance");

export function TasksTab({ data, me, now }: { data: Data; me: string; now: Date }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = data.tasks.find((t) => t.id === openId) ?? null;
  const others = data.members.filter((m) => m.user_id !== me);
  const otherLabel = others.length === 1 ? `Para ${shortName(data, others[0]!.user_id)}` : "Para o outro";

  const mine = data.tasks.filter((t) => t.assignee_id === me);
  const theirs = data.tasks.filter((t) => t.assignee_id && t.assignee_id !== me);
  const nobody = data.tasks.filter((t) => !t.assignee_id);

  return (
    <div className="relative flex h-full flex-col">
      <CreateTask data={data} me={me} />
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        <Section title="Para mim" tasks={mine} data={data} me={me} onOpen={setOpenId} />
        <Section title={otherLabel} tasks={theirs} data={data} me={me} onOpen={setOpenId} />
        {nobody.length > 0 && <Section title="Sem responsável" tasks={nobody} data={data} me={me} onOpen={setOpenId} />}
      </div>
      {open && <TaskPanel task={open} data={data} me={me} now={now} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function CreateTask({ data, me }: { data: Data; me: string }) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [assignee, setAssignee] = useState(me);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ws = data.workspace!;

  async function create() {
    const parsed = createTaskInputSchema.safeParse({ workspace_id: ws.id, title, prompt, assignee_id: assignee || null });
    if (!parsed.success) return setErr(parsed.error.issues[0]?.message ?? "dados inválidos");
    setBusy(true);
    setErr(null);
    const { error } = await supabase.from("tasks").insert({ ...parsed.data, created_by: me });
    setBusy(false);
    if (error) return setErr(error.message);
    setTitle("");
    setPrompt("");
    setAssignee(me);
    setExpanded(false);
  }

  const forOther = assignee && assignee !== me;
  return (
    <form
      className="space-y-1.5 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <div className="flex gap-1.5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => setExpanded(true)}
          maxLength={200}
          placeholder="Nova tarefa…"
          aria-label="Título da nova tarefa"
          className="min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-1 outline-none placeholder:text-muted focus:border-accent"
        />
        <button disabled={busy || !title.trim()} className="rounded-md bg-accent px-2 text-white disabled:opacity-40" aria-label="Criar tarefa">
          <Icon name="plus" size={13} />
        </button>
      </div>
      {expanded && (
        <>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={20000}
            rows={3}
            placeholder="Prompt para a IA de quem receber (opcional)"
            aria-label="Prompt da tarefa"
            className="block w-full resize-y rounded-md border border-line bg-raised px-2 py-1 leading-snug outline-none placeholder:text-muted focus:border-accent"
          />
          <div className="flex items-center gap-1.5 text-[10.5px]">
            <label htmlFor="new-assignee" className="text-muted">Para</label>
            <select
              id="new-assignee"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="min-w-0 flex-1 rounded border border-line bg-raised px-1 py-0.5"
            >
              {data.members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.user_id === me ? "Mim" : shortName(data, m.user_id)}
                </option>
              ))}
              <option value="">Sem responsável</option>
            </select>
            <span className="text-muted">{forOther ? "vai aguardar aceite" : "já nasce aceita"}</span>
            <button type="button" onClick={() => setExpanded(false)} className="text-muted hover:text-text" aria-label="Recolher">
              <Icon name="close" size={11} />
            </button>
          </div>
        </>
      )}
      {err && <p className="text-[10.5px] text-red-400">{err}</p>}
    </form>
  );
}

function Section({ title, tasks, data, me, onOpen }: { title: string; tasks: Task[]; data: Data; me: string; onOpen: (id: string) => void }) {
  const [showClosed, setShowClosed] = useState(false);
  const awaiting = tasks.filter((t) => t.status === "awaiting_acceptance");
  const active = tasks.filter((t) => t.status !== "awaiting_acceptance" && !CLOSED.includes(t.status)).sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.number - b.number);
  const declined = tasks.filter((t) => t.status === "declined");
  const done = tasks.filter((t) => t.status === "done").sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return (
    <section>
      <h2 className="flex items-center gap-1 py-1 text-[10.5px] font-semibold tracking-wide text-muted uppercase">
        {title} <span className="font-normal">{awaiting.length + active.length}</span>
      </h2>
      <div className="space-y-1">
        {awaiting.map((t) => (
          <AwaitingCard key={t.id} task={t} data={data} me={me} onOpen={() => onOpen(t.id)} />
        ))}
        {declined.map((t) => (
          <button key={t.id} type="button" onClick={() => onOpen(t.id)} className="block w-full rounded-md border border-warn/40 px-1.5 py-1 text-left hover:bg-raised">
            <div className="flex items-baseline gap-1.5">
              <span className="shrink-0 text-muted">#{t.number}</span>
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <span className="shrink-0 text-[10px] text-warn">recusada</span>
            </div>
            {t.decline_reason && <p className="truncate pl-5 text-[10.5px] text-muted">“{t.decline_reason}”</p>}
          </button>
        ))}
        {active.map((t) => (
          <TaskRow key={t.id} task={t} onOpen={() => onOpen(t.id)} />
        ))}
        {tasks.length === 0 && <p className="px-1.5 text-[10.5px] text-muted">nenhuma tarefa</p>}
        {done.length > 0 && (
          <>
            <button type="button" onClick={() => setShowClosed((v) => !v)} className="flex items-center gap-1 px-1.5 text-[10.5px] text-muted hover:text-text">
              <span className={`transition-transform ${showClosed ? "rotate-90" : ""}`}>
                <Icon name="chevron" size={9} />
              </span>
              Concluídas {done.length}
            </button>
            {showClosed && done.map((t) => <TaskRow key={t.id} task={t} onOpen={() => onOpen(t.id)} />)}
          </>
        )}
      </div>
    </section>
  );
}

function TaskRow({ task, onOpen }: { task: Task; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-baseline gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-raised">
      <span className="shrink-0 text-muted">#{task.number}</span>
      <span className={`min-w-0 flex-1 truncate ${task.status === "done" ? "text-muted line-through" : ""}`}>{task.title}</span>
      <span className="shrink-0 text-[10px] text-muted">{TASK_STATUS_LABELS[task.status]}</span>
    </button>
  );
}

/** Convite de tarefa: para mim, com Aceitar/Recusar; para o outro, só o aviso. */
function AwaitingCard({ task, data, me, onOpen }: { task: Task; data: Data; me: string; onOpen: () => void }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const forMe = task.assignee_id === me;
  return (
    <article className="rounded-md border border-accent/50 bg-panel px-2 py-1.5">
      <button type="button" onClick={onOpen} className="flex w-full items-baseline gap-1.5 text-left">
        <span className="shrink-0 text-muted">#{task.number}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
      </button>
      <p className="text-[10.5px] text-muted">
        {forMe ? `de ${shortName(data, task.created_by)}` : `aguardando aceite de ${shortName(data, task.assignee_id)}`}
      </p>
      {task.prompt && (
        <div className="mt-0.5">
          <button type="button" onClick={() => setShowPrompt((v) => !v)} className="flex items-center gap-1 text-[10.5px] text-accent">
            <span className={`transition-transform ${showPrompt ? "rotate-90" : ""}`}>
              <Icon name="chevron" size={9} />
            </span>
            {showPrompt ? "ocultar prompt" : "ver prompt"}
          </button>
          {showPrompt && <p className="mt-0.5 max-h-40 overflow-y-auto rounded bg-raised px-1.5 py-1 leading-snug whitespace-pre-wrap">{task.prompt}</p>}
        </div>
      )}
      {forMe && <RespondButtons task={task} />}
    </article>
  );
}

function RespondButtons({ task }: { task: Task }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function respond(fields: Partial<Task>) {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.from("tasks").update(fields).eq("id", task.id);
    setBusy(false);
    if (error) setErr(error.message);
  }

  if (declining) {
    const parsed = declineReasonSchema.safeParse(reason);
    return (
      <form
        className="mt-1 space-y-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed.success) void respond({ status: "declined", decline_reason: parsed.data });
        }}
      >
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="Motivo da recusa (obrigatório)"
          aria-label="Motivo da recusa"
          className="block w-full rounded-md border border-line bg-raised px-2 py-1 outline-none placeholder:text-muted focus:border-accent"
        />
        <div className="flex justify-end gap-1.5">
          <button type="button" onClick={() => setDeclining(false)} className="rounded-md px-2 py-0.5 text-muted hover:text-text">Cancelar</button>
          <button disabled={busy || !parsed.success} className="rounded-md border border-warn/60 px-2 py-0.5 text-warn disabled:opacity-40">Recusar</button>
        </div>
        {err && <p className="text-[10.5px] text-red-400">{err}</p>}
      </form>
    );
  }
  return (
    <div className="mt-1">
      <div className="flex justify-end gap-1.5">
        <button type="button" disabled={busy} onClick={() => setDeclining(true)} className="rounded-md border border-line px-2 py-0.5 hover:bg-raised disabled:opacity-40">
          Recusar
        </button>
        <button type="button" disabled={busy} onClick={() => void respond({ status: "backlog" })} className="rounded-md bg-accent px-2 py-0.5 text-white disabled:opacity-40">
          Aceitar
        </button>
      </div>
      {err && <p className="text-[10.5px] text-red-400">{err}</p>}
    </div>
  );
}

function TaskPanel({ task, data, me, now, onClose }: { task: Task; data: Data; me: string; now: Date; onClose: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const events = data.events.filter((e) => e.task_id === task.id).slice(0, 8);
  const links = data.links.filter((l) => l.task_id === task.id);

  // Eventos de mudança de status são gravados pelo banco (trigger), com a origem certa.
  async function patch(fields: Partial<Task>) {
    setErr(null);
    const { error } = await supabase.from("tasks").update(fields).eq("id", task.id);
    if (error) setErr(error.message);
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
          <span className="text-muted">Enviada por</span>
          <span>{task.created_by === me ? "você" : shortName(data, task.created_by)}</span>
          <label className="text-muted" htmlFor="st">Status</label>
          {task.status === "awaiting_acceptance" || task.status === "declined" ? (
            <span className={task.status === "declined" ? "text-warn" : ""}>{TASK_STATUS_LABELS[task.status]}</span>
          ) : (
            <select id="st" value={task.status} onChange={(e) => void patch({ status: e.target.value as TaskStatus })} className="rounded border border-line bg-raised px-1 py-0.5">
              {WORK_STATUSES.map((s) => (
                <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>
              ))}
            </select>
          )}
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
        {task.status === "awaiting_acceptance" && task.assignee_id === me && <RespondButtons task={task} />}
        {task.status === "awaiting_acceptance" && task.assignee_id !== me && (
          <p className="text-[10.5px] text-muted">Aguardando {shortName(data, task.assignee_id)} aceitar. Trocar o responsável envia um novo convite.</p>
        )}
        {task.status === "declined" && (
          <Block title="Motivo da recusa">
            <p>{task.decline_reason}</p>
            <button type="button" onClick={() => void patch({ status: "awaiting_acceptance" })} className="mt-1 rounded-md border border-line px-2 py-0.5 hover:bg-raised">
              Reenviar para {shortName(data, task.assignee_id)}
            </button>
          </Block>
        )}
        {err && <p className="text-[10.5px] text-red-400">{err}</p>}
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
                {shortName(data, e.user_id)} · {describeEvent(e.type, e.payload, (id) => shortName(data, id))}
              </span>
              <SourceBadge source={e.source} />
            </div>
          ))}
        </Block>
      </div>
    </aside>
  );
}

/** Texto curto de um evento, usado no painel da tarefa e na aba Atividade. */
export function describeEvent(type: string, p: Record<string, unknown>, name: (id: string | null) => string): string {
  const to = p.to_status as TaskStatus | undefined;
  switch (type) {
    case "task_created":
      return p.assignee_id && to === "awaiting_acceptance" ? `criou e enviou para ${name(String(p.assignee_id))}` : "criou a tarefa";
    case "task_sent":
      return `enviou para ${name(String(p.assignee_id))}`;
    case "start_task":
      return `iniciou tarefa${p.branch ? ` em ${p.branch}` : ""}`;
    case "report_progress":
      return String(p.text ?? "progresso");
    case "complete_task":
      return `concluiu: ${String(p.summary ?? "")}`;
    case "status_changed":
      if (p.from_status === "awaiting_acceptance" && to === "backlog") return "aceitou a tarefa";
      if (to === "declined") return `recusou: ${String(p.reason ?? "")}`;
      if (p.from_status === "declined" && to === "awaiting_acceptance") return "reenviou a tarefa";
      return `status ${TASK_STATUS_LABELS[p.from_status as TaskStatus] ?? p.from_status} → ${TASK_STATUS_LABELS[to!] ?? to}`;
    case "git_snapshot":
      return `git: ${p.branch ?? "?"}${p.commit ? ` @ ${p.commit}` : ""}`;
    case "post_tool_use":
      return `usou ${p.tool_name ?? "ferramenta"}`;
    default:
      return type.replaceAll("_", " ");
  }
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-0.5 text-[10.5px] font-semibold tracking-wide text-muted uppercase">{title}</h3>
      <div className="space-y-0.5 leading-snug whitespace-pre-wrap">{children}</div>
    </section>
  );
}
