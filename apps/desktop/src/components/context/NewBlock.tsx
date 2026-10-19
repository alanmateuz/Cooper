import { splitContext } from "@cooper/shared";
import { useState } from "react";
import { contextApi } from "../../lib/api";
import { friendlyError } from "../../lib/errors";
import type { WorkspaceData } from "../../lib/useWorkspace";
import { FIELD } from "./shared";

export function NewBlock({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="space-y-1 rounded-md border border-accent/50 bg-panel p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void contextApi.create(workspaceId, title, content).then(onDone, (x) => setErr(friendlyError(x)));
      }}
    >
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Título (ex.: Contratos de API)" aria-label="Título do novo bloco" className={FIELD} />
      <textarea value={content} onChange={(e) => setContent(e.target.value)} maxLength={20000} rows={5} placeholder="Conteúdo" aria-label="Conteúdo do novo bloco" className={`${FIELD} resize-y`} />
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onDone} className="rounded-md px-2 py-0.5 text-muted hover:text-text">
          Cancelar
        </button>
        <button disabled={!title.trim()} className="rounded-md bg-accent px-2 py-0.5 text-white disabled:opacity-40">
          Criar
        </button>
      </div>
      {err && <p className="text-[10.5px] text-danger">{err}</p>}
    </form>
  );
}

/** Colar um texto grande: os títulos (#, ##, ###) viram blocos. Mostra o que vai ser criado antes. */
export function PasteContext({ data, onDone }: { data: WorkspaceData; onDone: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const existing = new Set(data.context.filter((b) => !b.deleted_at).map((b) => b.title.toLowerCase()));
  const parts = splitContext(text);
  const fresh = parts.filter((p) => !existing.has(p.title.toLowerCase()) && p.content.length <= 20000);

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      for (const p of fresh) await contextApi.create(data.workspace!.id, p.title, p.content);
      onDone();
    } catch (x) {
      setErr(friendlyError(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1 rounded-md border border-accent/50 bg-panel p-2">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder={"Cole aqui. Ex.:\n# Resumo\n…\n## Arquitetura\n…"}
        aria-label="Texto do contexto"
        className={`${FIELD} resize-y`}
      />
      {parts.length > 0 && (
        <ul className="space-y-0.5 text-[10.5px]">
          {parts.map((p) => (
            <li key={p.title} className="flex gap-1.5">
              <span className="min-w-0 flex-1 truncate">{p.title}</span>
              <span className="shrink-0 text-muted">
                {existing.has(p.title.toLowerCase())
                  ? "já existe, fica de fora (edite o bloco)"
                  : p.content.length > 20000
                    ? "grande demais (até 20.000), fica de fora"
                    : `${p.content.length.toLocaleString("pt-BR")} caracteres`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onDone} className="rounded-md px-2 py-0.5 text-muted hover:text-text">
          Cancelar
        </button>
        <button type="button" disabled={busy || fresh.length === 0} onClick={() => void create()} className="rounded-md bg-accent px-2 py-0.5 text-white disabled:opacity-40">
          Criar {fresh.length} {fresh.length === 1 ? "bloco" : "blocos"}
        </button>
      </div>
      {err && <p className="text-[10.5px] text-danger">{err}</p>}
    </div>
  );
}
