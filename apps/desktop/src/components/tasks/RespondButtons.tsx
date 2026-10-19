import { declineReasonSchema, type Task } from "@cooper/shared";
import { useState } from "react";
import { updateTask } from "../../lib/api";

/** Aceitar / Recusar (com motivo). `inline`: botões à direita da linha do remetente. */
export function RespondButtons({ task, inline }: { task: Task; inline?: boolean }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function respond(fields: Partial<Task>) {
    setBusy(true);
    setErr(null);
    try {
      setErr(await updateTask(task.id, fields));
    } finally {
      setBusy(false);
    }
  }

  if (declining) {
    const parsed = declineReasonSchema.safeParse(reason);
    return (
      <form
        className={inline ? "basis-full space-y-1" : "mt-1 space-y-1"}
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
          <button type="button" onClick={() => setDeclining(false)} className="rounded-md px-2 py-0.5 text-muted hover:text-text">
            Cancelar
          </button>
          <button disabled={busy || !parsed.success} className="rounded-md border border-warn/60 px-2 py-0.5 text-warn disabled:opacity-40">
            Recusar
          </button>
        </div>
        {err && <p className="text-[10.5px] text-danger">{err}</p>}
      </form>
    );
  }
  return (
    <div className={inline ? "ml-auto" : "mt-1"}>
      <div className="flex justify-end gap-1.5">
        <button type="button" disabled={busy} onClick={() => setDeclining(true)} className="rounded-md border border-line bg-panel px-2 py-0.5 hover:bg-raised disabled:opacity-40">
          Recusar
        </button>
        <button type="button" disabled={busy} onClick={() => void respond({ status: "backlog" })} className="rounded-md bg-accent px-2 py-0.5 text-white disabled:opacity-40">
          Aceitar
        </button>
      </div>
      {err && <p className="text-[10.5px] text-danger">{err}</p>}
    </div>
  );
}
