import type { ContextBlock } from "@cooper/shared";
import { useState } from "react";
import { contextApi } from "../../lib/api";
import { friendlyError } from "../../lib/errors";
import { timeAgo } from "../../lib/format";
import type { WorkspaceData } from "../../lib/useWorkspace";
import { ConfirmBar, Icon, SourceBadge } from "../ui";
import { EditBlock } from "./EditBlock";
import { History } from "./History";
import { who } from "./shared";

export function BlockCard({ block, data, now, open, setOpen }: { block: ContextBlock; data: WorkspaceData; now: Date; open: boolean; setOpen: (v: boolean) => void }) {
  const [mode, setMode] = useState<"view" | "edit" | "history">("view");
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    setDeleting(true);
    setErr(null);
    try {
      const r = await contextApi.remove(block.id, block.version);
      if (!r.ok) setErr(r.message);
      else setConfirmDelete(false);
    } catch (x) {
      setErr(friendlyError(x));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-panel">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-start gap-2 px-3 py-2 text-left">
        <span className={`mt-1 text-muted transition-transform ${open ? "rotate-90" : ""}`}>
          <Icon name="chevron" size={10} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{block.title}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted" title={new Date(block.updated_at).toLocaleString("pt-BR")}>
            <span className="truncate">
              {who(data, block.updated_by, block.updated_agent)} · {timeAgo(block.updated_at, now)} · v{block.version}
            </span>
            {block.updated_source !== "user" && <SourceBadge source={block.updated_source} />}
          </span>
        </span>
        {!open && block.content && <span className="mt-0.5 shrink-0 text-[10px] text-muted tabular-nums">{block.content.length.toLocaleString("pt-BR")} car.</span>}
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3 pl-[30px]">
          {mode === "view" && (
            <>
              <p className="leading-relaxed whitespace-pre-wrap select-text">{block.content || "(vazio)"}</p>
              <div className="flex gap-2 text-[10.5px]">
                <button type="button" onClick={() => setMode("edit")} className="text-accent hover:underline">
                  editar
                </button>
                <button type="button" onClick={() => setMode("history")} className="text-accent hover:underline">
                  histórico
                </button>
                <button type="button" onClick={() => setConfirmDelete(true)} className="text-muted hover:text-danger">
                  apagar
                </button>
              </div>
              {confirmDelete && (
                <ConfirmBar
                  text={`Apagar o bloco "${block.title}"? Dá para desfazer pelo aviso de mudanças.`}
                  confirmLabel="Apagar"
                  busy={deleting}
                  onConfirm={() => void remove()}
                  onCancel={() => setConfirmDelete(false)}
                />
              )}
            </>
          )}
          {mode === "edit" && <EditBlock block={block} onDone={() => setMode("view")} />}
          {mode === "history" && <History block={block} data={data} now={now} onDone={() => setMode("view")} />}
          {err && <p className="text-[10.5px] text-danger">{err}</p>}
        </div>
      )}
    </section>
  );
}
