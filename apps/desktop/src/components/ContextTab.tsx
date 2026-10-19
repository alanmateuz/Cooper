import { useState } from "react";
import type { WorkspaceData } from "../lib/useWorkspace";
import { BlockCard } from "./context/BlockCard";
import { NewBlock, PasteContext } from "./context/NewBlock";
import { RecentChanges } from "./context/RecentChanges";
import { Icon } from "./ui";

/** Aba Contexto: blocos livres, edição inline, colar texto grande, histórico por bloco e "desfazer". */
export function ContextTab({ data, me, now }: { data: WorkspaceData; me: string; now: Date }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState<"new" | "paste" | null>(null);
  const blocks = data.context.filter((b) => !b.deleted_at);

  // Botões fixos no topo: criar ou colar sem precisar rolar até o fim da lista.
  const btn = (on: boolean) =>
    `flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 transition-colors ${on ? "bg-accent text-white" : "border border-line bg-panel hover:bg-raised"}`;
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-1.5 border-b border-line px-2.5 py-2">
        <button type="button" aria-pressed={adding === "new"} onClick={() => setAdding(adding === "new" ? null : "new")} className={btn(adding === "new")}>
          <Icon name="plus" size={11} /> Novo bloco
        </button>
        <button type="button" aria-pressed={adding === "paste"} onClick={() => setAdding(adding === "paste" ? null : "paste")} className={btn(adding === "paste")}>
          <Icon name="list" size={11} /> Colar contexto
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2.5">
        {adding === "new" && <NewBlock workspaceId={data.workspace!.id} onDone={() => setAdding(null)} />}
        {adding === "paste" && <PasteContext data={data} onDone={() => setAdding(null)} />}
        <RecentChanges data={data} me={me} now={now} onShow={(id) => setOpen((o) => ({ ...o, [id]: true }))} />
        {blocks.length === 0 && !adding && (
          <p className="px-1 pt-6 pb-2 text-center leading-snug text-muted">Nenhum contexto ainda. Cole um texto (os títulos # viram blocos) ou crie um bloco.</p>
        )}
        {blocks.map((b) => (
          <BlockCard key={b.id} block={b} data={data} now={now} open={open[b.id] ?? false} setOpen={(v) => setOpen((o) => ({ ...o, [b.id]: v }))} />
        ))}
      </div>
    </div>
  );
}
