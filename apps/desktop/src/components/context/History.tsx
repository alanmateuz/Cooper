import type { ContextBlock, ContextBlockVersion } from "@cooper/shared";
import { useEffect, useState } from "react";
import { contextApi } from "../../lib/api";
import { friendlyError } from "../../lib/errors";
import { timeAgo } from "../../lib/format";
import { supabase } from "../../lib/supabase";
import type { WorkspaceData } from "../../lib/useWorkspace";
import { who } from "./shared";

export function History({ block, data, now, onDone }: { block: ContextBlock; data: WorkspaceData; now: Date; onDone: () => void }) {
  const [versions, setVersions] = useState<ContextBlockVersion[] | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // recarrega quando o bloco muda (inclusive por outra pessoa)
  useEffect(() => {
    void supabase
      .from("context_block_history")
      .select("*")
      .eq("block_id", block.id)
      .order("version", { ascending: false })
      .limit(50)
      .then(({ data: rows, error }) => (error ? setErr(friendlyError(error)) : setVersions((rows ?? []) as ContextBlockVersion[])));
  }, [block.id, block.version]);

  async function restore(v: number) {
    setErr(null);
    try {
      const r = await contextApi.restore(block.id, v, block.version);
      if (!r.ok) setErr(r.message);
    } catch (x) {
      setErr(friendlyError(x));
    }
  }

  return (
    <div className="space-y-1 text-[10.5px]">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-muted">Histórico</span>
        <button type="button" onClick={onDone} className="text-muted hover:text-text">
          fechar
        </button>
      </div>
      <div className="text-muted">
        v{block.version} (atual) · {who(data, block.updated_by, block.updated_agent)} · {timeAgo(block.updated_at, now)}
      </div>
      {versions?.length === 0 && <p className="text-muted">Sem versões anteriores.</p>}
      {versions?.map((v) => (
        <div key={v.id} className="space-y-0.5">
          <div className="flex items-baseline gap-1.5">
            <span className="min-w-0 flex-1 truncate">
              v{v.version} · {who(data, v.written_by, v.written_agent)} · {timeAgo(v.written_at, now)}
              {v.title !== block.title && <span className="text-muted"> · “{v.title}”</span>}
            </span>
            <button type="button" onClick={() => setShown(shown === v.version ? null : v.version)} className="text-accent hover:underline">
              {shown === v.version ? "ocultar" : "ver"}
            </button>
            <button type="button" onClick={() => void restore(v.version)} className="text-accent hover:underline">
              restaurar
            </button>
          </div>
          {shown === v.version && <p className="max-h-32 overflow-y-auto rounded bg-raised p-1 whitespace-pre-wrap text-muted select-text">{v.content || "(vazio)"}</p>}
        </div>
      ))}
      {err && <p className="text-danger">{err}</p>}
    </div>
  );
}
