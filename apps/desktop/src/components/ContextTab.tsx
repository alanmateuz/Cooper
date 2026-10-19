import {
  authorLabel,
  splitContext,
  type AgentKind,
  type ContextBlock,
  type ContextBlockVersion,
  type ContextWriteResult,
  type TaskEvent,
} from "@cooper/shared";
import { useEffect, useState } from "react";
import { timeAgo } from "../lib/format";
import { supabase } from "../lib/supabase";
import type { WorkspaceData } from "../lib/useWorkspace";
import { Icon, SourceBadge } from "./ui";

type Data = WorkspaceData;

const nameOf = (d: Data, id: string | null) =>
  d.members.find((m) => m.user_id === id)?.profile?.display_name.replace(/\s*\(.*\)/, "") ?? "alguém";
const who = (d: Data, id: string | null, agent: AgentKind | null) => (id ? authorLabel(nameOf(d, id), agent) : "contexto inicial");

async function rpc(fn: string, args: Record<string, unknown>): Promise<ContextWriteResult> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as ContextWriteResult;
}

const VERB: Record<string, string> = { create: "criou", update: "atualizou", restore: "restaurou", delete: "apagou" };

/** Aba Contexto: blocos livres, edição inline, colar texto grande, histórico por bloco e "desfazer". */
export function ContextTab({ data, me, now }: { data: Data; me: string; now: Date }) {
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
          <p className="px-1 pt-6 pb-2 text-center leading-snug text-muted">
            Nenhum contexto ainda. Cole um texto (os títulos # viram blocos) ou crie um bloco.
          </p>
        )}
        {blocks.map((b) => (
          <BlockCard key={b.id} block={b} data={data} now={now} open={open[b.id] ?? false} setOpen={(v) => setOpen((o) => ({ ...o, [b.id]: v }))} />
        ))}
      </div>
    </div>
  );
}

/** "Codex de Ian atualizou Arquitetura · ver · desfazer" — mudanças dos outros nas últimas 24 h. */
function RecentChanges({ data, me, now, onShow }: { data: Data; me: string; now: Date; onShow: (id: string) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const recent = data.events
    .filter((e) => e.type === "context_updated" && e.user_id !== me && now.getTime() - new Date(e.occurred_at).getTime() < 86_400_000)
    .slice(0, 3);
  if (recent.length === 0) return null;

  async function undo(e: TaskEvent, b: ContextBlock) {
    setErr(null);
    const v = Number(e.payload.version);
    try {
      const r =
        e.payload.action === "create"
          ? await rpc("context_delete", { p_block: b.id, p_base_version: b.version })
          : await rpc("context_restore", { p_block: b.id, p_version: v - 1, p_base_version: b.version });
      if (!r.ok) setErr(r.message);
    } catch (x) {
      setErr(String(x));
    }
  }

  return (
    <section className="space-y-1 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2">
      <h2 className="text-[10px] font-semibold tracking-wide text-muted uppercase">Mudanças recentes</h2>
      {recent.map((e) => {
        const b = data.context.find((x) => x.id === e.payload.block_id);
        const agent = data.sessions.find((s) => s.id === e.agent_session_id)?.agent_kind ?? null;
        // desfazer só vale se ninguém mexeu no bloco depois desta mudança
        const canUndo = !!b && b.version === Number(e.payload.version);
        return (
          <div key={e.id} className="flex items-baseline gap-1 text-[10.5px]">
            <span className="min-w-0 flex-1 truncate">
              <b>{who(data, e.user_id, agent)}</b> {VERB[String(e.payload.action)] ?? "mudou"} <i>{String(e.payload.block_title ?? "")}</i>
              <span className="text-muted"> · {timeAgo(e.occurred_at, now)}</span>
            </span>
            {b && !b.deleted_at && (
              <button type="button" onClick={() => onShow(b.id)} className="shrink-0 text-accent hover:underline">ver</button>
            )}
            {canUndo && (
              <button type="button" onClick={() => void undo(e, b!)} className="shrink-0 text-accent hover:underline">desfazer</button>
            )}
            {e.source !== "user" && <SourceBadge source={e.source} />}
          </div>
        );
      })}
      {err && <p className="text-[10.5px] text-danger">{err}</p>}
    </section>
  );
}

function BlockCard({ block, data, now, open, setOpen }: { block: ContextBlock; data: Data; now: Date; open: boolean; setOpen: (v: boolean) => void }) {
  const [mode, setMode] = useState<"view" | "edit" | "history">("view");
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    if (!confirm(`Apagar o bloco "${block.title}"? Dá para desfazer pelo aviso de mudanças.`)) return;
    try {
      const r = await rpc("context_delete", { p_block: block.id, p_base_version: block.version });
      if (!r.ok) setErr(r.message);
    } catch (x) {
      setErr(String(x));
    }
  }

  return (
    <section className="rounded-xl border border-line bg-panel">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-start gap-2 px-3 py-2 text-left">
        <span className={`mt-1 text-muted transition-transform ${open ? "rotate-90" : ""}`}>
          <Icon name="chevron" size={10} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{block.title}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted" title={new Date(block.updated_at).toLocaleString("pt-BR")}>
            <span className="truncate">
              {who(data, block.updated_by, block.updated_agent)} · {timeAgo(block.updated_at, now)} · v{block.version}
            </span>
            {block.updated_source !== "user" && <SourceBadge source={block.updated_source} />}
          </span>
        </span>
        {!open && block.content && <span className="mt-0.5 shrink-0 text-[10px] text-muted tabular-nums">{block.content.length.toLocaleString("pt-BR")} car.</span>}
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3 pl-[30px]">
          {mode === "view" && (
            <>
              <p className="leading-relaxed whitespace-pre-wrap select-text">{block.content || "(vazio)"}</p>
              <div className="flex gap-2 text-[10.5px]">
                <button type="button" onClick={() => setMode("edit")} className="text-accent hover:underline">editar</button>
                <button type="button" onClick={() => setMode("history")} className="text-accent hover:underline">histórico</button>
                <button type="button" onClick={() => void remove()} className="text-muted hover:text-danger">apagar</button>
              </div>
            </>
          )}
          {mode === "edit" && <EditBlock block={block} onDone={() => setMode("view")} />}
          {mode === "history" && <History block={block} data={data} now={now} onDone={() => setMode("view")} />}
          {err && <p className="text-[10.5px] text-danger">{err}</p>}
        </div>
      )}
    </section>
  );
}

/**
 * Edição contra base_version. Se outra pessoa (ou IA) gravou antes, nada se perde: o rascunho fica no editor,
 * o conteúdo atual aparece acima para mesclar, e o próximo "Salvar" vale contra a versão nova.
 */
function EditBlock({ block, onDone }: { block: ContextBlock; onDone: () => void }) {
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
      const r = await rpc("context_update", { p_block: block.id, p_title: title, p_content: content, p_base_version: base });
      if (r.ok) return onDone();
      setConflict({ content: r.current.content, version: r.current.version, message: r.message });
      setBase(r.current.version);
    } catch (x) {
      setErr(String(x));
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
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
        aria-label="Título do bloco"
        className="block w-full rounded-md border border-line bg-raised px-2 py-1 font-medium outline-none focus:border-accent"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={20000}
        rows={8}
        aria-label="Conteúdo do bloco"
        className="block w-full resize-y rounded-md border border-line bg-raised px-2 py-1 leading-snug outline-none focus:border-accent"
      />
      <div className="flex items-center justify-end gap-1.5">
        <span className="mr-auto text-[10px] text-muted">{content.length.toLocaleString("pt-BR")} / 20.000</span>
        <button type="button" onClick={onDone} className="rounded-md px-2 py-0.5 text-muted hover:text-text">Cancelar</button>
        <button disabled={busy || !title.trim()} className="rounded-md bg-accent px-2 py-0.5 text-white disabled:opacity-40">Salvar</button>
      </div>
      {err && <p className="text-[10.5px] text-danger">{err}</p>}
    </form>
  );
}

function History({ block, data, now, onDone }: { block: ContextBlock; data: Data; now: Date; onDone: () => void }) {
  const [versions, setVersions] = useState<ContextBlockVersion[] | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // recarrega quando o bloco muda (inclusive por outra pessoa)
  useEffect(() => {
    void supabase
      .from("context_block_history")
      .select("*")
      .eq("block_id", block.id)
      .order("version", { ascending: false })
      .limit(50)
      .then(({ data: rows, error }) => (error ? setErr(error.message) : setVersions((rows ?? []) as ContextBlockVersion[])));
  }, [block.id, block.version]);

  async function restore(v: number) {
    setErr(null);
    try {
      const r = await rpc("context_restore", { p_block: block.id, p_version: v, p_base_version: block.version });
      if (!r.ok) setErr(r.message);
    } catch (x) {
      setErr(String(x));
    }
  }

  return (
    <div className="space-y-1 text-[10.5px]">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-muted">Histórico</span>
        <button type="button" onClick={onDone} className="text-muted hover:text-text">fechar</button>
      </div>
      <div className="text-muted">
        v{block.version} (atual) · {who(data, block.updated_by, block.updated_agent)} · {timeAgo(block.updated_at, now)}
      </div>
      {versions?.length === 0 && <p className="text-muted">Sem versões anteriores.</p>}
      {versions?.map((v) => (
        <div key={v.id} className="space-y-0.5">
          <div className="flex items-baseline gap-1.5">
            <span className="min-w-0 flex-1 truncate">
              v{v.version} · {who(data, v.written_by, v.written_agent)} · {timeAgo(v.written_at, now)}
              {v.title !== block.title && <span className="text-muted"> · “{v.title}”</span>}
            </span>
            <button type="button" onClick={() => setShown(shown === v.version ? null : v.version)} className="text-accent hover:underline">
              {shown === v.version ? "ocultar" : "ver"}
            </button>
            <button type="button" onClick={() => void restore(v.version)} className="text-accent hover:underline">restaurar</button>
          </div>
          {shown === v.version && <p className="max-h-32 overflow-y-auto rounded bg-raised p-1 whitespace-pre-wrap text-muted select-text">{v.content || "(vazio)"}</p>}
        </div>
      ))}
      {err && <p className="text-danger">{err}</p>}
    </div>
  );
}

function NewBlock({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="space-y-1 rounded-md border border-accent/50 bg-panel p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void rpc("context_create", { p_workspace: workspaceId, p_title: title, p_content: content }).then(onDone, (x) => setErr(String(x)));
      }}
    >
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Título (ex.: Contratos de API)" aria-label="Título do novo bloco" className="block w-full rounded-md border border-line bg-raised px-2 py-1 outline-none focus:border-accent" />
      <textarea value={content} onChange={(e) => setContent(e.target.value)} maxLength={20000} rows={5} placeholder="Conteúdo" aria-label="Conteúdo do novo bloco" className="block w-full resize-y rounded-md border border-line bg-raised px-2 py-1 leading-snug outline-none focus:border-accent" />
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onDone} className="rounded-md px-2 py-0.5 text-muted hover:text-text">Cancelar</button>
        <button disabled={!title.trim()} className="rounded-md bg-accent px-2 py-0.5 text-white disabled:opacity-40">Criar</button>
      </div>
      {err && <p className="text-[10.5px] text-danger">{err}</p>}
    </form>
  );
}

/** Colar um texto grande: os títulos (#, ##, ###) viram blocos. Mostra o que vai ser criado antes. */
function PasteContext({ data, onDone }: { data: Data; onDone: () => void }) {
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
      for (const p of fresh) await rpc("context_create", { p_workspace: data.workspace!.id, p_title: p.title, p_content: p.content });
      onDone();
    } catch (x) {
      setErr(String(x));
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
        className="block w-full resize-y rounded-md border border-line bg-raised px-2 py-1 leading-snug outline-none focus:border-accent"
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
        <button type="button" onClick={onDone} className="rounded-md px-2 py-0.5 text-muted hover:text-text">Cancelar</button>
        <button type="button" disabled={busy || fresh.length === 0} onClick={() => void create()} className="rounded-md bg-accent px-2 py-0.5 text-white disabled:opacity-40">
          Criar {fresh.length} {fresh.length === 1 ? "bloco" : "blocos"}
        </button>
      </div>
      {err && <p className="text-[10.5px] text-danger">{err}</p>}
    </div>
  );
}
