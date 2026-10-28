import type { Task } from "@cooper/shared";
import { useEffect, useRef, useState } from "react";
import { friendlyError } from "../../lib/errors";
import { timeAgo } from "../../lib/format";
import { memberName } from "../../lib/names";
import { supabase } from "../../lib/supabase";
import type { WorkspaceData } from "../../lib/useWorkspace";
import { inTauri } from "../../lib/window";
import { ConfirmBar } from "../ui";

const BUCKET = "task-files";
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 20;

interface Attachment {
  id: string;
  path: string;
  name: string;
  size_bytes: number;
  mime: string | null;
  uploaded_by: string;
  created_at: string;
}

const size = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/** Salva o arquivo baixado: no app, na pasta Downloads (Rust); no navegador, pelo download comum. */
async function saveFile(name: string, blob: Blob): Promise<string> {
  if (inTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return invoke<string>("save_download", bytes, { headers: { "x-file-name": encodeURIComponent(name) } });
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return `Downloads/${name}`;
}

/**
 * Anexos da tarefa. O arquivo fica no Supabase Storage (bucket privado); a lista vem de task_attachments.
 * Recarrega quando chega um evento de anexo desta tarefa (Realtime de task_events).
 */
export function Attachments({ task, data, me }: { task: Task; data: WorkspaceData; me: string }) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<Attachment | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const changes = data.events.filter((e) => e.task_id === task.id && (e.type === "attachment_added" || e.type === "attachment_removed")).length;

  useEffect(() => {
    void supabase
      .from("task_attachments")
      .select("id,path,name,size_bytes,mime,uploaded_by,created_at")
      .eq("task_id", task.id)
      .order("created_at")
      .then(({ data: rows }) => setItems((rows ?? []) as Attachment[]));
  }, [task.id, changes]);

  const isOwner = data.members.find((m) => m.user_id === me)?.role === "owner";
  const canDelete = (a: Attachment) => a.uploaded_by === me || task.created_by === me || isOwner;

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setMsg(null);
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        setMsg({ ok: false, text: `"${file.name}" tem ${size(file.size)}; o limite é 10 MB por arquivo.` });
        continue;
      }
      if (items.length >= MAX_FILES) {
        setMsg({ ok: false, text: "Esta tarefa já tem 20 anexos (o limite)." });
        break;
      }
      setBusy(file.name);
      const safe = file.name.replace(/[^\w.\-() ]+/g, "_").slice(-120);
      const path = `${task.workspace_id}/${task.id}/${crypto.randomUUID()}-${safe}`;
      const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (up.error) {
        setMsg({ ok: false, text: friendlyError(up.error) });
        setBusy(null);
        continue;
      }
      const row = await supabase.from("task_attachments").insert({
        workspace_id: task.workspace_id, task_id: task.id, path, name: file.name.slice(0, 200), size_bytes: file.size, mime: file.type || null, uploaded_by: me,
      });
      if (row.error) {
        await supabase.storage.from(BUCKET).remove([path]); // não deixa arquivo órfão
        setMsg({ ok: false, text: friendlyError(row.error) });
      }
      setBusy(null);
    }
    if (input.current) input.current.value = "";
  }

  async function download(a: Attachment) {
    setBusy(a.id);
    setMsg(null);
    try {
      const { data: blob, error } = await supabase.storage.from(BUCKET).download(a.path);
      if (error || !blob) throw error ?? new Error("arquivo não encontrado");
      setMsg({ ok: true, text: `Salvo em ${await saveFile(a.name, blob)}` });
    } catch (e) {
      setMsg({ ok: false, text: friendlyError(e) });
    } finally {
      setBusy(null);
    }
  }

  async function remove(a: Attachment) {
    setBusy(a.id);
    const { error } = await supabase.from("task_attachments").delete().eq("id", a.id);
    if (!error) await supabase.storage.from(BUCKET).remove([a.path]);
    else setMsg({ ok: false, text: friendlyError(error) });
    setBusy(null);
    setConfirm(null);
  }

  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-[10.5px] font-semibold tracking-wide text-muted uppercase">Anexos {items.length > 0 && items.length}</h3>
        <button type="button" disabled={!!busy || items.length >= MAX_FILES} onClick={() => input.current?.click()} className="rounded px-1.5 text-[10.5px] text-accent hover:bg-raised disabled:opacity-50">
          {busy && !items.some((a) => a.id === busy) ? "enviando…" : "+ anexar"}
        </button>
        <input ref={input} type="file" multiple className="hidden" onChange={(e) => void upload(e.target.files)} aria-label="Anexar arquivos" />
      </div>
      {items.length === 0 ? (
        <p className="text-[10.5px] text-muted">Nenhum anexo. Até 10 MB por arquivo.</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((a) => (
            <li key={a.id} className="anim-in flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-raised">
              <button type="button" onClick={() => void download(a)} disabled={busy === a.id} className="min-w-0 flex-1 truncate text-left text-accent hover:underline" title={`Baixar ${a.name}`}>
                {a.name}
              </button>
              <span className="shrink-0 text-[10px] text-muted" title={new Date(a.created_at).toLocaleString("pt-BR")}>
                {size(a.size_bytes)} · {memberName(data, a.uploaded_by)} · {timeAgo(a.created_at, new Date())}
              </span>
              {canDelete(a) && (
                <button type="button" onClick={() => setConfirm(a)} className="shrink-0 rounded px-1 text-[10px] text-muted hover:text-danger" aria-label={`Apagar ${a.name}`}>
                  apagar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {confirm && (
        <ConfirmBar text={`Apagar "${confirm.name}"? Não dá para desfazer.`} confirmLabel="Apagar" onConfirm={() => void remove(confirm)} onCancel={() => setConfirm(null)} busy={busy === confirm.id} />
      )}
      {msg && <p className={`mt-1 text-[10.5px] leading-snug ${msg.ok ? "text-run" : "text-danger"}`}>{msg.text}</p>}
    </section>
  );
}
