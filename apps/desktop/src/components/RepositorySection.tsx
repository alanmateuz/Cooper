import { useState } from "react";
import { friendlyError } from "../lib/errors";
import { gitStatus, repoPath, sameRepo, setRepoPath, type GitStatus, type Repository } from "../lib/repo";
import { supabase } from "../lib/supabase";
import { inTauri } from "../lib/window";

async function pickFolder(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ directory: true, multiple: false, title: "Pasta do projeto (onde está o .git)" });
  return typeof r === "string" ? r : null;
}

/**
 * Ajustes → Repositório. O dono escolhe uma vez a pasta do projeto, e o repositório do GitHub dela vira o do time.
 * Cada pessoa depois aponta onde está a própria cópia; o app confere se é o mesmo repositório.
 * O caminho fica só nesta máquina; para o time vão branch, sha, à frente/atrás e quantos arquivos alterados.
 */
export function RepositorySection({
  workspaceId,
  isOwner,
  repo,
  onRepoChange,
  onPathChange,
}: {
  workspaceId: string;
  isOwner: boolean;
  repo: Repository | null;
  onRepoChange: () => void;
  onPathChange: () => void;
}) {
  const [path, setPath] = useState(() => repoPath(workspaceId));
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!inTauri) return <p className="text-[10.5px] text-muted">A pasta do projeto se escolhe no app desktop.</p>;

  const savePath = (p: string | null) => {
    setRepoPath(workspaceId, p);
    setPath(p);
    onPathChange();
  };

  async function choose() {
    setErr(null);
    setBusy(true);
    try {
      const dir = await pickFolder();
      if (!dir) return;
      const s = await gitStatus(dir);
      if (!s.remote) throw new Error("essa pasta não tem um remoto do GitHub (origin)");
      if (repo) {
        if (!sameRepo(repo, s)) throw new Error(`essa pasta é de github.com/${s.remote.owner}/${s.remote.name}, não do repositório do time`);
      } else {
        const { error } = await supabase.from("repositories").insert({ workspace_id: workspaceId, owner: s.remote.owner, name: s.remote.name });
        if (error) throw error;
        onRepoChange();
      }
      setStatus(s);
      savePath(dir);
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const btn = "rounded-md border border-line px-2 py-0.5 hover:bg-raised disabled:opacity-40";
  return (
    <div className="space-y-1.5">
      {repo ? (
        <p>
          Repositório do time: <b>github.com/{repo.owner}/{repo.name}</b>
        </p>
      ) : (
        <p className="text-[10.5px] leading-snug text-muted">
          {isOwner
            ? "Escolha a pasta do projeto na sua máquina. O repositório do GitHub dela vira o do time, e quem entrar só aponta a própria cópia."
            : "O dono do projeto ainda não escolheu o repositório."}
        </p>
      )}

      {path ? (
        <div className="space-y-1 rounded-md bg-raised/60 p-1.5 text-[10.5px] leading-snug">
          <p className="break-all">
            Sua cópia: <code>{path}</code>
          </p>
          {status && (
            <p className="text-muted">
              {status.branch ?? "HEAD destacado"}
              {status.dirty_files_count > 0 && ` · ${status.dirty_files_count} alterações`}
              {status.behind ? ` · ${status.behind} atrás` : ""}
            </p>
          )}
          <p className="text-muted">A cada minuto o time vê sua branch e quantos arquivos você alterou (nunca nomes nem conteúdo).</p>
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => savePath(null)} className="rounded-md px-2 py-0.5 text-muted hover:text-text">
              Parar de enviar
            </button>
            <button type="button" disabled={busy} onClick={() => void choose()} className={btn}>
              Trocar pasta
            </button>
          </div>
        </div>
      ) : (
        (repo || isOwner) && (
          <button type="button" disabled={busy} onClick={() => void choose()} className={btn}>
            {busy ? "Lendo a pasta…" : repo ? "Onde está a sua cópia?" : "Escolher pasta do projeto"}
          </button>
        )
      )}
      {err && <p className="text-[10.5px] text-danger">{err}</p>}
    </div>
  );
}
