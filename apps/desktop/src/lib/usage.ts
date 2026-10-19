import { localDay, usageRows, type UsageReport } from "@cooper/shared";
import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { inTauri } from "./window";

const POLL_MS = 60_000;

/**
 * Uso de IA desta máquina, lido pelo app desktop a cada minuto (só números; veja ai_usage.rs).
 * Fora do Tauri (navegador) não há leitura: devolve null e o cartão mostra "sem dados de uso".
 */
export function useLocalUsage(): UsageReport | null {
  const [report, setReport] = useState<UsageReport | null>(null);
  useEffect(() => {
    if (!inTauri) return;
    let alive = true;
    const read = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const r = await invoke<UsageReport>("read_ai_usage", { sinceMs: localDay().startMs });
        if (alive) setReport(r);
      } catch {
        // formato inesperado ou pasta ausente: segue sem dados
      }
    };
    void read();
    const t = setInterval(() => void read(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return report;
}

/** Envia o uso ao workspace só quando o compartilhamento está ligado, e só quando muda. */
export function useShareUsage(report: UsageReport | null, workspaceId: string | null, userId: string, sharing: boolean) {
  const last = useRef("");
  useEffect(() => {
    if (!report || !workspaceId || !sharing) {
      last.current = "";
      return;
    }
    const rows = usageRows(report, workspaceId, userId, localDay().day);
    const key = JSON.stringify(rows.map(({ observed_at: _, ...r }) => r));
    if (rows.length === 0 || key === last.current) return;
    last.current = key;
    void supabase.from("ai_usage").upsert(rows, { onConflict: "workspace_id,user_id,agent_kind" });
  }, [report, workspaceId, userId, sharing]);
}
