import type { ContextBlock, TaskEvent } from "@cooper/shared";
import { useState } from "react";
import { contextApi } from "../../lib/api";
import { friendlyError } from "../../lib/errors";
import { timeAgo } from "../../lib/format";
import type { WorkspaceData } from "../../lib/useWorkspace";
import { SourceBadge } from "../ui";
import { VERB, who } from "./shared";

/** "Codex de Ian atualizou Arquitetura · ver · desfazer": mudanças dos outros nas últimas 24 h. */
export function RecentChanges({ data, me, now, onShow }: { data: WorkspaceData; me: string; now: Date; onShow: (id: string) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const recent = data.events
    .filter((e) => e.type === "context_updated" && e.user_id !== me && now.getTime() - new Date(e.occurred_at).getTime() < 86_400_000)
    .slice(0, 3);
  if (recent.length === 0) return null;

  async function undo(e: TaskEvent, b: ContextBlock) {
    setErr(null);
    const v = Number(e.payload.version);
    try {
      const r = e.payload.action === "create" ? await contextApi.remove(b.id, b.version) : await contextApi.restore(b.id, v - 1, b.version);
      if (!r.ok) setErr(r.message);
    } catch (x) {
      setErr(friendlyError(x));
    }
  }

  return (
    <section className="space-y-1 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2">
      <h2 className="text-[10px] font-semibold tracking-wide text-muted uppercase">Mudanças recentes</h2>
      {recent.map((e) => {
        const b = data.context.find((x) => x.id === e.payload.block_id);
        const agent = data.sessions.find((s) => s.id === e.agent_session_id)?.agent_kind ?? null;
        // desfazer só vale se ninguém mexeu no bloco depois desta mudança
        const canUndo = !!b && b.version === Number(e.payload.version);
        return (
          <div key={e.id} className="flex items-baseline gap-1 text-[10.5px]">
            <span className="min-w-0 flex-1 truncate">
              <b>{who(data, e.user_id, agent)}</b> {VERB[String(e.payload.action)] ?? "mudou"} <i>{String(e.payload.block_title ?? "")}</i>
              <span className="text-muted"> · {timeAgo(e.occurred_at, now)}</span>
            </span>
            {b && !b.deleted_at && (
              <button type="button" onClick={() => onShow(b.id)} className="shrink-0 text-accent hover:underline">
                ver
              </button>
            )}
            {canUndo && (
              <button type="button" onClick={() => void undo(e, b!)} className="shrink-0 text-accent hover:underline">
                desfazer
              </button>
            )}
            {e.source !== "user" && <SourceBadge source={e.source} />}
          </div>
        );
      })}
      {err && <p className="text-[10.5px] text-danger">{err}</p>}
    </section>
  );
}
