import { createTaskInputSchema } from "@cooper/shared";
import { useState } from "react";
import { createTask } from "../../lib/api";
import { memberName } from "../../lib/names";
import type { WorkspaceData } from "../../lib/useWorkspace";
import { Icon } from "../ui";

export function CreateTask({ data, me }: { data: WorkspaceData; me: string }) {
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
    try {
      const error = await createTask(parsed.data, me);
      if (error) return setErr(error);
      setTitle("");
      setPrompt("");
      setAssignee(me);
      setExpanded(false);
    } finally {
      setBusy(false);
    }
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
            <label htmlFor="new-assignee" className="text-muted">
              Para
            </label>
            <select id="new-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} className="min-w-0 flex-1 rounded border border-line bg-raised px-1 py-0.5">
              {data.members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.user_id === me ? "Mim" : memberName(data, m.user_id)}
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
      {err && <p className="text-[10.5px] text-danger">{err}</p>}
    </form>
  );
}
