import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { WorkspaceData } from "../../lib/useWorkspace";

const fmt = new Intl.NumberFormat("pt-BR");

/**
 * Tamanho do contexto que as IAs leem (tokens = estimativa, caracteres ÷ 4) e o efeito do último resumo.
 * Resumir é pedido à IA ("resume o contexto do Cooper"): ela usa summarize_context e save_context_summary.
 */
export function ContextSize({ data }: { data: WorkspaceData }) {
  const [last, setLast] = useState<{ before: number; after: number; at: string } | null>(null);
  const blocks = data.context.filter((b) => !b.deleted_at);
  const chars = blocks.reduce((n, b) => n + b.content.length, 0);
  const versionKey = blocks.map((b) => b.version).join(",");

  useEffect(() => {
    if (!data.workspace) return;
    void supabase
      .from("context_summaries")
      .select("chars_before,chars_after,created_at")
      .eq("workspace_id", data.workspace.id)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data: rows }) => {
        if (!rows?.length) return setLast(null);
        // resumo de uma rodada: soma os blocos resumidos nos 10 minutos do mais recente
        const t0 = new Date(rows[0]!.created_at).getTime();
        const round = rows.filter((r) => t0 - new Date(r.created_at).getTime() < 10 * 60_000);
        setLast({ before: round.reduce((n, r) => n + r.chars_before, 0), after: round.reduce((n, r) => n + r.chars_after, 0), at: rows[0]!.created_at });
      });
  }, [data.workspace, versionKey]);

  if (blocks.length === 0) return null;
  const cut = last && last.before > 0 ? Math.round(100 - (100 * last.after) / last.before) : null;
  return (
    <p className="px-1 text-[10.5px] text-muted" title='Para diminuir, peça à sua IA: "resume o contexto do Cooper". O anterior fica no histórico de cada bloco.'>
      {fmt.format(chars)} caracteres · ~{fmt.format(Math.round(chars / 4))} tokens (estimativa)
      {cut != null && cut > 0 && (
        <span className="text-run"> · último resumo −{cut}% ({fmt.format(last!.before)} → {fmt.format(last!.after)})</span>
      )}
    </p>
  );
}
