import { useState } from "react";
import { friendlyError } from "../lib/errors";
import { inTauri } from "../lib/window";

interface Plan {
  file: string;
  installed: boolean;
  previous: string | null;
  command: string;
  backup: string | null;
}

/**
 * ⚙ → Limites do Claude Code. Os JSONL do Claude Code não trazem limites. Duas fontes: atualização em segundo plano
 * (claude_limits.rs, opcional) e a status line, instalada no settings.json só depois de mostrar o que muda.
 */
export function ClaudeStatusLine({ autoRefresh, setAutoRefresh }: { autoRefresh: boolean; setAutoRefresh: (v: boolean) => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!inTauri) return null;

  async function call(cmd: string) {
    setBusy(true);
    setErr(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<Plan>(cmd);
    } catch (e) {
      setErr(friendlyError(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function apply(cmd: "install_claude_statusline" | "remove_claude_statusline") {
    const r = await call(cmd);
    if (!r) return;
    setPlan(null);
    setDone(
      cmd === "install_claude_statusline"
        ? `Instalado em ${r.file}${r.backup ? " (com backup)" : ""}. Os limites aparecem depois da próxima resposta do Claude Code.`
        : `Removido${r.previous ? "; sua status line anterior voltou" : ""}.`,
    );
  }

  return (
    <details className="space-y-1.5">
      <summary className="cursor-pointer font-medium">Limites do Claude Code</summary>
      <p className="pt-1 text-[10.5px] leading-snug text-muted">
        Os arquivos do Claude Code não trazem os limites de 5 h e da semana (planos Pro e Max). O Cooper os lê de duas formas, guardando só os
        números nesta máquina:
      </p>
      <label className="flex items-start gap-1.5 text-[10.5px] leading-snug">
        <input type="checkbox" className="mt-0.5" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
        <span>
          <b>Atualizar a cada 1 h</b> (ou pelo botão no seu cartão). Roda o Claude Code em segundo plano com uma mensagem curta no Haiku; isso
          gasta um pouco do seu limite.
        </span>
      </label>
      <p className="text-[10.5px] leading-snug text-muted">
        <b>Status line:</b> atualiza a cada resposta, sem gasto extra, mas só no Claude Code do terminal (o app desktop do Claude não roda status
        line).
      </p>
      {!plan && (
        <button type="button" disabled={busy} onClick={() => void call("preview_claude_statusline").then((p) => p && (setPlan(p), setDone(null)))} className="rounded border border-line px-2 py-0.5 hover:bg-raised disabled:opacity-40">
          Status line: ver o que muda
        </button>
      )}
      {plan && (
        <div className="space-y-1 rounded-md border border-accent/50 p-1.5 text-[10.5px] leading-snug">
          <p>
            Arquivo: <code className="break-all">{plan.file}</code>
          </p>
          {plan.installed ? (
            <p>A status line do Cooper já está instalada.</p>
          ) : plan.previous ? (
            <p>
              Sua status line atual continua aparecendo: o Cooper repassa os dados para ela. <code className="break-all text-muted">{plan.previous}</code>
            </p>
          ) : (
            <p>Você não tem status line; a do Cooper mostra modelo e limites.</p>
          )}
          <p className="text-muted">
            Comando: <code className="break-all">{plan.command}</code>
          </p>
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setPlan(null)} className="rounded-md px-2 py-0.5 text-muted hover:text-text">Cancelar</button>
            {plan.installed && (
              <button type="button" disabled={busy} onClick={() => void apply("remove_claude_statusline")} className="rounded-md border border-line px-2 py-0.5 hover:bg-raised disabled:opacity-40">
                Remover
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => void apply("install_claude_statusline")} className="rounded-md bg-accent px-2 py-0.5 text-white disabled:opacity-40">
              {plan.installed ? "Reinstalar" : "Confirmar e instalar"}
            </button>
          </div>
        </div>
      )}
      {done && <p className="text-[10.5px] leading-snug text-run">{done}</p>}
      {err && <p className="text-[10.5px] text-danger">{err}</p>}
    </details>
  );
}
