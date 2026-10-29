import { useState } from "react";
import { friendlyError } from "../lib/errors";
import { inTauri } from "../lib/window";

interface Plan {
  file: string;
  installed: boolean;
  events: string[];
  command: string;
  others: number;
  backup: string | null;
}

/**
 * Ajustes → Agentes → Status em tempo real. Instala hooks do Claude Code (claude_hooks.rs) que avisam o Cooper
 * quando o agente começa a trabalhar e quando para. Mostra antes o arquivo, os eventos e o comando.
 * `demo`: no navegador (?demo), simula as respostas sem tocar em arquivo nenhum.
 */
export function ClaudeHooks({ demo }: { demo?: boolean } = {}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [demoOn, setDemoOn] = useState(false);
  if (!inTauri && !demo) return null;

  async function call(cmd: "preview_claude_hooks" | "install_claude_hooks" | "remove_claude_hooks") {
    setBusy(true);
    setErr(null);
    try {
      if (demo) {
        const on = cmd === "install_claude_hooks" ? true : cmd === "remove_claude_hooks" ? false : demoOn;
        setDemoOn(on);
        return { file: "C:/Users/voce/.claude/settings.json", installed: on, events: ["UserPromptSubmit", "PreToolUse", "Stop"], command: 'node "C:/…/Cooper/mcp/cooper-hook.js"', others: 1, backup: "settings.json.bak-cooper-…" };
      }
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<Plan>(cmd);
    } catch (e) {
      setErr(friendlyError(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function apply(cmd: "install_claude_hooks" | "remove_claude_hooks") {
    const r = await call(cmd);
    if (!r) return;
    setPlan(null);
    setDone(
      cmd === "install_claude_hooks"
        ? `Ligado em ${r.file}${r.backup ? " (com backup)" : ""}. Vale para conversas novas do Claude Code.`
        : "Desligado. Os outros hooks continuam como estavam.",
    );
  }

  return (
    <div className="space-y-1.5">
      <div>
        <div className="font-medium">Status em tempo real (Claude Code)</div>
        <p className="text-[10.5px] leading-snug text-muted">
          Mostra "executando" no seu cartão enquanto o agente trabalha. O hook manda só o nome do evento: nada de prompt, comando ou arquivo.
        </p>
      </div>
      {!plan && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void call("preview_claude_hooks").then((p) => p && (setPlan(p), setDone(null)))}
          className="rounded-md border border-line px-2 py-0.5 hover:bg-raised disabled:opacity-40"
        >
          Ver o que muda
        </button>
      )}
      {plan && (
        <div className="space-y-1 rounded-md border border-line bg-raised/60 p-1.5 text-[10.5px] leading-snug">
          <p>
            Arquivo: <code className="break-all">{plan.file}</code>
          </p>
          <p>
            {plan.installed ? "Já está ligado. " : ""}Eventos: {plan.events.join(", ")}.
            {plan.others > 0 && (plan.others === 1 ? " Seu hook atual nesses eventos continua." : ` Seus ${plan.others} hooks atuais nesses eventos continuam.`)}
          </p>
          <p className="text-muted">
            Comando: <code className="break-all">{plan.command}</code>
          </p>
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setPlan(null)} className="rounded-md px-2 py-0.5 text-muted hover:text-text">
              Cancelar
            </button>
            {plan.installed && (
              <button type="button" disabled={busy} onClick={() => void apply("remove_claude_hooks")} className="rounded-md border border-line px-2 py-0.5 hover:bg-raised disabled:opacity-40">
                Desligar
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => void apply("install_claude_hooks")} className="rounded-md bg-accent px-2 py-0.5 text-white disabled:opacity-40">
              {plan.installed ? "Reinstalar" : "Confirmar e ligar"}
            </button>
          </div>
        </div>
      )}
      {done && <p className="text-[10.5px] leading-snug text-muted">{done}</p>}
      {err && <p className="text-[10.5px] text-danger">{err}</p>}
    </div>
  );
}
