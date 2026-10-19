import type { ContextBlock } from "@cooper/shared";
import { useState } from "react";
import { contextApi } from "../../lib/api";
import { friendlyError } from "../../lib/errors";
import { FIELD } from "./shared";

/**
 * Edição contra base_version. Se outra pessoa (ou IA) gravou antes, nada se perde: o rascunho fica no editor,
 * o conteúdo atual aparece acima para mesclar, e o próximo "Salvar" vale contra a versão nova.
 */
export function EditBlock({ block, onDone }: { block: ContextBlock; onDone: () => void }) {
  const [title, setTitle] = useState(block.title);
  const [content, setContent] = useState(block.content);
  const [base, setBase] = useState(block.version);
  const [conflict, setConflict] = useState<{ content: string; version: number; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const r = await contextApi.update(block.id, title, content, base);
      if (r.ok) return onDone();
      setConflict({ content: r.current.content, version: r.current.version, message: r.message });
      setBase(r.current.version);
    } catch (x) {
      setErr(friendlyError(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {conflict && (
        <div className="space-y-1 rounded-md border border-warn/60 p-1.5 text-[10.5px]">
          <p className="text-warn">Alguém salvou este bloco enquanto você editava (agora na v{conflict.version}). Seu texto continua abaixo: mescle e salve de novo.</p>
          <p className="max-h-28 overflow-y-auto rounded bg-raised p-1 whitespace-pre-wrap text-muted select-text">{conflict.content}</p>
          <button type="button" onClick={() => setContent(conflict.content)} className="text-accent hover:underline">
            trocar meu texto pelo atual
          </button>
        </div>
      )}
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} aria-label="Título do bloco" className={`${FIELD} font-medium`} />
      <textarea value={content} onChange={(e) => setContent(e.target.value)} maxLength={20000} rows={8} aria-label="Conteúdo do bloco" className={`${FIELD} resize-y`} />
      <div className="flex items-center justify-end gap-1.5">
        <span className="mr-auto text-[10px] text-muted">{content.length.toLocaleString("pt-BR")} / 20.000</span>
        <button type="button" onClick={onDone} className="rounded-md px-2 py-0.5 text-muted hover:text-text">
          Cancelar
        </button>
        <button disabled={busy || !title.trim()} className="rounded-md bg-accent px-2 py-0.5 text-white disabled:opacity-40">
          Salvar
        </button>
      </div>
      {err && <p className="text-[10.5px] text-danger">{err}</p>}
    </form>
  );
}
