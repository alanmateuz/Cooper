import { localDay, usageRows, type UsageReport } from "@cooper/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { friendlyError } from "./errors";
import { pref } from "./format";
import { supabase } from "./supabase";
import { inTauri } from "./window";

const POLL_MS = 60_000;
/** Atualização automática do limite do Claude Code (opcional; cada uma é uma mensagem curta no Haiku). */
export const CLAUDE_AUTO_REFRESH_MS = 60 * 60_000;
export const CLAUDE_AUTO_REFRESH_PREF = "claudeAutoRefresh";

/**
 * Uso de IA desta máquina, lido pelo app desktop a cada minuto (só números; veja ai_usage.rs).
 * Fora do Tauri (navegador) não há leitura: devolve null e o cartão mostra "sem dados de uso".
 */
export function useLocalUsage(): { report: UsageReport | null; reload: () => Promise<void> } {
  const [report, setReport] = useState<UsageReport | null>(null);
  const reload = useCallback(async () => {
    if (!inTauri) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      setReport(await invoke<UsageReport>("read_ai_usage", { sinceMs: localDay().startMs }));
    } catch {
      // formato inesperado ou pasta ausente: segue sem dados
    }
  }, []);
  useEffect(() => {
    if (!inTauri) return;
    void reload();
    const t = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(t);
  }, [reload]);
  return { report, reload };
}

/** Roda `claude -p` em segundo plano para ler os limites do Claude Code (claude_limits.rs). Lança a mensagem de erro. */
export async function refreshClaudeLimits(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("refresh_claude_limits");
}

/** Se a pessoa ligou, atualiza o limite do Claude Code a cada hora (e ao abrir, se a leitura for mais velha que isso). */
export function useClaudeAutoRefresh(enabled: boolean, report: UsageReport | null, reload: () => Promise<void>) {
  const running = useRef(false);
  const observedAt = report?.claude_code?.limits_observed_at ?? 0;
  useEffect(() => {
    if (!inTauri || !enabled) return;
    const tick = async () => {
      if (running.current || Date.now() - observedAt < CLAUDE_AUTO_REFRESH_MS) return;
      running.current = true;
      try {
        await refreshClaudeLimits();
        await reload();
      } catch {
        // sem login, sem plano com limite ou Claude Code ausente: o cartão continua com o último dado
      } finally {
        running.current = false;
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 5 * 60_000);
    return () => clearInterval(t);
  }, [enabled, observedAt, reload]);
}

export const claudeAutoRefreshPref = () => pref(CLAUDE_AUTO_REFRESH_PREF, false);

/** Resultado do último envio, mostrado em ⚙ → Privacidade. */
export type ShareStatus = { at: Date; error: string | null } | null;

/**
 * Envia o uso ao workspace só quando o compartilhamento está ligado, e só quando muda.
 * Só lembra o que foi enviado depois que o banco aceitar: se falhar, tenta de novo na próxima leitura (a cada minuto).
 */
export function useShareUsage(report: UsageReport | null, workspaceId: string | null, userId: string, sharing: boolean): ShareStatus {
  const last = useRef("");
  const sending = useRef(false);
  const [status, setStatus] = useState<ShareStatus>(null);
  useEffect(() => {
    if (!report || !workspaceId || !sharing) {
      last.current = "";
      if (!sharing) setStatus(null);
      return;
    }
    if (sending.current) return;
    let rows;
    try {
      rows = usageRows(report, workspaceId, userId, localDay().day);
    } catch (e) {
      setStatus({ at: new Date(), error: `dados de uso inválidos: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    const key = JSON.stringify(rows.map(({ observed_at: _, ...r }) => r));
    if (rows.length === 0 || key === last.current) return;
    sending.current = true;
    void (async () => {
      try {
        const { error } = await supabase.from("ai_usage").upsert(rows, { onConflict: "workspace_id,user_id,agent_kind" });
        if (!error) last.current = key;
        setStatus({ at: new Date(), error: error?.message ?? null });
      } catch (e) {
        setStatus({ at: new Date(), error: friendlyError(e) });
      } finally {
        sending.current = false;
      }
    })();
  }, [report, workspaceId, userId, sharing]);
  return status;
}
