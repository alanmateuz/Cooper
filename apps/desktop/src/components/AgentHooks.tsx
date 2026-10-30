import { AGENT_LABELS } from "@cooper/shared";
import { useState } from "react";
import { friendlyError } from "../lib/errors";
import { inTauri } from "../lib/window";
import { BrandIcon } from "./ui";

interface Plan {
  file: string;
  installed: boolean;
  events: string[];
  command: string;
  others: number;
  backup: string | null;
}

type Kind = "claude_code" | "codex";
const KINDS: Kind[] = ["claude_code", "codex"];

/**
 * Ajustes → Agentes → Status em tempo real. Instala hooks no Claude Code e no Codex (agent_hooks.rs) que avisam
 * o Cooper quando o agente começa a trabalhar e quando para. Mostra antes o arquivo, os eventos e o comando.
 * `demo`: no navegador (?demo), simula as respostas sem tocar em arquivo nenhum.
 */
export function AgentHooks({ demo }: { demo?: boolean } = {}) {
  const [plan, setPlan] = useState<(Plan & { kind: Kind }) | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [demoOn, setDemoOn] = useState<Record<Kind, boolean>>({ claude_code: false, codex: false });
  if (!inTauri && !demo) return null;

  async function call(cmd: "preview_agent_hooks" | "install_agent_hooks" | "remove_agent_hooks", kind: Kind) {
    setBusy(true);
    setErr(null);
    try {
      if (demo) {
        const on = cmd === "install_agent_hooks" ? true : cmd === "remove_agent_hooks" ? false : demoOn[kind];
        setDemoOn((d) => ({ ...d, [kind]: on }));
        const file = kind === "codex" ? "C:/Users/voce/.codex/hooks.json" : "C:/Users/voce/.claude/settings.json";
        return { file, installed: on, events: ["UserPromptSubmit", "PreToolUse", "Stop"], command: `node "C:/…/Cooper/mcp/cooper-hook.js" ${kind}`, others: kind === "codex" ? 0 : 1, backup: "….bak-cooper-…" };
      }
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<Plan>(cmd, { kind });
    } catch (e) {
      setErr(friendlyError(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function apply(cmd: "install_agent_hooks" | "remove_agent_hooks", kind: Kind) {
    const r = await call(cmd, kind);
    if (!r) return;
    setPlan(null);
    const next = kind === "codex" ? " No Codex, aprove uma vez com /hooks numa conversa nova." : " Vale para conversas novas do Claude Code.";
    setDone(
      cmd === "install_agent_hooks"
        ? `${AGENT_LABELS[kind]}: ligado em ${r.file}${r.backup ? " (com backup)" : ""}.${next}`
        : `${AGENT_LABELS[kind]}: desligado. Os outros hooks continuam como estavam.`,
    );
  }

  const btn = "rounded-md border border-line px-2 py-0.5 hover:bg-raised disabled:opacity-40";
  return (
    <div className="space-y-1.5">
      <div>
        <div className="font-medium">Status em tempo real</div>
        <p className="text-[10.5px] leading-snug text-muted">
          Mostra "executando" no seu cartão enquanto o agente trabalha. O hook manda só o nome do evento: nada de prompt, comando ou arquivo.
        </p>
      </div>
      {!plan && (
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button key={k} type="button" disabled={busy} onClick={() => void call("preview_agent_hooks", k).then((p) => p && (setPlan({ ...p, kind: k }), setDone(null)))} className={`${btn} inline-flex items-center gap-1.5`}>
              <BrandIcon brand={k} size={12} />
              {AGENT_LABELS[k]}: ver o que muda
            </button>
          ))}
        </div>
      )}
      {plan && (
        <div className="space-y-1 rounded-md border border-line bg-raised/60 p-1.5 text-[10.5px] leading-snug">
          <p className="flex items-center gap-1.5 font-medium">
            <BrandIcon brand={plan.kind} size={12} />
            {AGENT_LABELS[plan.kind]}
          </p>
          <p>
            Arquivo: <code className="break-all">{plan.file}</code>
          </p>
          <p>
            {plan.installed ? "Já está ligado. " : ""}Eventos: {plan.events.join(", ")}.
            {plan.others > 0 && (plan.others === 1 ? " Seu hook atual nesses eventos continua." : ` Seus ${plan.others} hooks atuais nesses eventos continuam.`)}
          </p>
          {plan.kind === "codex" && <p className="text-muted">O Codex pede para você aprovar os hooks uma vez, com /hooks.</p>}
          <p className="text-muted">
            Comando: <code className="break-all">{plan.command}</code>
          </p>
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setPlan(null)} className="rounded-md px-2 py-0.5 text-muted hover:text-text">
              Cancelar
            </button>
            {plan.installed && (
              <button type="button" disabled={busy} onClick={() => void apply("remove_agent_hooks", plan.kind)} className={btn}>
                Desligar
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => void apply("install_agent_hooks", plan.kind)} className="rounded-md bg-accent px-2 py-0.5 text-white disabled:opacity-40">
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
