import { agentInstructionsMarkdown } from "@cooper/shared";
import { useState } from "react";
import { inTauri } from "../lib/window";

interface FilePlan {
  name: string;
  path: string;
  action: "create" | "append" | "replace" | "unchanged";
}

const ACTION_LABEL: Record<FilePlan["action"], string> = {
  create: "será criado",
  append: "o trecho será acrescentado ao final",
  replace: "o trecho do Cooper será atualizado (o resto fica igual)",
  unchanged: "já está atualizado",
};

/**
 * Configurações → Regras para os agentes: trecho para CLAUDE.md / AGENTS.md.
 * Nada é gravado sem a pessoa ver o trecho, o que acontece com cada arquivo e confirmar.
 */
export function ProjectInstructions() {
  const block = agentInstructionsMarkdown();
  const [copied, setCopied] = useState(false);
  const [repo, setRepo] = useState("");
  const [plans, setPlans] = useState<FilePlan[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<FilePlan[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function call<T>(cmd: string, args: Record<string, unknown>): Promise<T | null> {
    setBusy(true);
    setErr(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<T>(cmd, args);
    } catch (e) {
      setErr(String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    setResult(null);
    const p = await call<FilePlan[]>("preview_agent_instructions", { repo, block });
    setPlans(p);
    if (p) setChosen(Object.fromEntries(p.map((f) => [f.name, f.action !== "unchanged"])));
  }

  async function write() {
    const files = plans?.filter((f) => chosen[f.name]).map((f) => f.name) ?? [];
    const r = await call<FilePlan[]>("write_agent_instructions", { repo, block, files });
    if (r) {
      setResult(r);
      setPlans(null);
    }
  }

  return (
    <details className="space-y-1.5">
      <summary className="cursor-pointer font-medium">Regras para os agentes</summary>
      <p className="pt-1 text-[10.5px] leading-snug text-muted">
        O servidor MCP já envia estas regras aos agentes. Para garantir, grave também no <code>CLAUDE.md</code> (Claude Code) e no{" "}
        <code>AGENTS.md</code> (Codex) do repositório.
      </p>
      <pre className="max-h-32 overflow-y-auto rounded bg-raised p-1.5 text-[10px] leading-snug whitespace-pre-wrap select-text">{block}</pre>
      <button
        type="button"
        onClick={() => void navigator.clipboard.writeText(block).then(() => setCopied(true))}
        className="rounded border border-line px-2 py-0.5 hover:bg-raised"
      >
        {copied ? "Copiado" : "Copiar trecho"}
      </button>

      {inTauri && (
        <div className="space-y-1.5 pt-1">
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              void preview();
            }}
          >
            <input
              value={repo}
              onChange={(e) => {
                setRepo(e.target.value);
                setPlans(null);
              }}
              placeholder="Pasta do repositório (ex.: C:\code\hacko)"
              aria-label="Pasta do repositório"
              className="min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-1 outline-none placeholder:text-muted focus:border-accent"
            />
            <button disabled={busy || !repo.trim()} className="rounded-md border border-line px-2 hover:bg-raised disabled:opacity-40">
              Ver
            </button>
          </form>

          {plans && (
            <div className="space-y-1 rounded-md border border-accent/50 p-1.5">
              <p className="text-[10.5px]">O que vai acontecer:</p>
              {plans.map((f) => (
                <label key={f.name} className="flex items-start gap-1.5 text-[10.5px]">
                  <input
                    type="checkbox"
                    disabled={f.action === "unchanged"}
                    checked={!!chosen[f.name]}
                    onChange={(e) => setChosen((c) => ({ ...c, [f.name]: e.target.checked }))}
                  />
                  <span>
                    <b>{f.name}</b>: {ACTION_LABEL[f.action]}
                    <span className="block truncate text-muted" title={f.path}>{f.path}</span>
                  </span>
                </label>
              ))}
              <div className="flex justify-end gap-1.5">
                <button type="button" onClick={() => setPlans(null)} className="rounded-md px-2 py-0.5 text-muted hover:text-text">Cancelar</button>
                <button
                  type="button"
                  disabled={busy || !plans.some((f) => chosen[f.name])}
                  onClick={() => void write()}
                  className="rounded-md bg-accent px-2 py-0.5 text-white disabled:opacity-40"
                >
                  Confirmar e gravar
                </button>
              </div>
            </div>
          )}
          {result && (
            <p className="text-[10.5px] leading-snug text-run">
              Gravado: {result.map((f) => `${f.name} (${f.action === "unchanged" ? "sem mudança" : ACTION_LABEL[f.action]})`).join("; ")}. Faça commit
              para o outro membro receber.
            </p>
          )}
        </div>
      )}
      {err && <p className="text-[10.5px] text-red-400">{err}</p>}
    </details>
  );
}
