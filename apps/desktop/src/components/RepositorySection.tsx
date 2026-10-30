import { useEffect, useState } from "react";
import { friendlyError } from "../lib/errors";
import { githubToken, setGithubToken, syncGithub } from "../lib/github";
import { gitStatus, repoPath, sameRepo, setRepoPath, type GitStatus, type Repository } from "../lib/repo";
import { supabase } from "../lib/supabase";
import { inTauri } from "../lib/window";
import { Toggle } from "./OtherTabs";
import { BrandIcon } from "./ui";

const DEMO_STATUS: GitStatus = { remote: { owner: "alanmateuz", name: "hacko" }, branch: "claude/header", head_sha: null, ahead: 0, behind: 1, dirty_files_count: 3 };

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
  demo,
  repoAccess,
  humanReview,
  onHumanReview,
}: {
  workspaceId: string;
  isOwner: boolean;
  repo: Repository | null;
  /** no modo demonstração recebe o remoto escolhido, já que nada é gravado no servidor */
  onRepoChange: (remote?: { owner: string; name: string }) => void;
  onPathChange: () => void;
  /** demonstração no navegador (?demo): pasta e git simulados */
  demo?: boolean;
  /** acesso desta pessoa ao repositório, lido do GitHub (undefined: servidor sem o esquema 20) */
  repoAccess?: "write" | "read" | "none" | null;
  /** revisão humana do projeto; undefined = servidor sem o esquema 18 */
  humanReview?: boolean;
  onHumanReview?: (on: boolean) => Promise<void>;
}) {
  const [path, setPath] = useState(() => repoPath(workspaceId));
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // ao abrir os Ajustes, mostra a branch atual da cópia já escolhida
  useEffect(() => {
    if (!path || (!inTauri && !demo)) return;
    (demo ? Promise.resolve(DEMO_STATUS) : gitStatus(path)).then(setStatus, () => setStatus(null));
  }, [path, demo]);

  if (!inTauri && !demo) return <p className="text-[10.5px] text-muted">A pasta do projeto se escolhe no app desktop.</p>;

  const savePath = (p: string | null) => {
    setRepoPath(workspaceId, p);
    setPath(p);
    onPathChange();
  };

  async function choose() {
    setErr(null);
    setBusy(true);
    try {
      const dir = demo ? "C:/Users/voce/code/hacko" : await pickFolder();
      if (!dir) return;
      const s = demo ? DEMO_STATUS : await gitStatus(dir);
      if (!s.remote) throw new Error("essa pasta não tem um remoto do GitHub (origin)");
      if (repo) {
        if (!sameRepo(repo, s)) throw new Error(`essa pasta é de github.com/${s.remote.owner}/${s.remote.name}, não do repositório do time`);
      } else if (demo) {
        onRepoChange(s.remote);
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
        <p className="flex items-center gap-1.5">
          <BrandIcon brand="github" size={13} />
          <span>
            Repositório do time: <b>github.com/{repo.owner}/{repo.name}</b>
          </span>
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
      {repo && <GithubAccess workspaceId={workspaceId} repo={repo} access={repoAccess} demo={demo} onSaved={onPathChange} />}
      {humanReview !== undefined && <HumanReview on={humanReview} isOwner={isOwner} repo={repo} onChange={onHumanReview} />}
    </div>
  );
}

/**
 * Só pessoas aprovam: o agente leva tarefas até "Em revisão" (servidor) e o hook barra `gh pr merge`/`--approve`
 * (máquina de cada um, com os hooks ligados). Para o GitHub exigir também, a proteção de branch fica no GitHub.
 */
function HumanReview({ on, isOwner, repo, onChange }: { on: boolean; isOwner: boolean; repo: Repository | null; onChange?: (on: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-1 border-t border-line pt-2">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">Só pessoas aprovam PRs</div>
          <p className="text-[10.5px] leading-snug text-muted">
            Ligado, a IA não aprova nem faz merge de pull requests (o hook de cada um bloqueia) e as tarefas que ela conclui param em
            <b> Em revisão</b> até alguém aprovar. Desligado, a IA pode concluir sozinha.
            {!isOwner && " Só o dono do projeto muda."}
          </p>
        </div>
        <Toggle
          checked={on}
          disabled={!isOwner || busy || !onChange}
          label="Só pessoas aprovam PRs"
          onChange={(v) => {
            setBusy(true);
            setErr(null);
            onChange?.(v)
              .catch((e) => setErr(friendlyError(e)))
              .finally(() => setBusy(false));
          }}
        />
      </div>
      {on && repo && (
        <p className="text-[10.5px] leading-snug text-muted">
          Para o próprio GitHub também exigir:{" "}
          <a href={`https://github.com/${repo.owner}/${repo.name}/settings/branches`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            proteção de branch
          </a>{" "}
          → "Require a pull request before merging" com 1 aprovação.
        </p>
      )}
      {on && <p className="text-[10.5px] leading-snug text-muted">O bloqueio de PR precisa do "Status em tempo real" ligado em ⚙ → Agentes.</p>}
      {err && <p className="text-[10.5px] text-danger">{err}</p>}
    </div>
  );
}

const ACCESS_LABEL = { write: "escrita", read: "só leitura (push vai falhar)", none: "sem acesso" } as const;

/**
 * GitHub: token opcional (só nesta máquina) para ler PRs de repositório privado e saber o acesso de escrita.
 * Sem token, o app lê só repositório público. O que o app lê vai para o time: PRs, CI, revisão e o seu acesso.
 */
function GithubAccess({
  workspaceId,
  repo,
  access,
  demo,
  onSaved,
}: {
  workspaceId: string;
  repo: Repository;
  access?: "write" | "read" | "none" | null;
  demo?: boolean;
  onSaved: () => void;
}) {
  const [hasToken, setHasToken] = useState(() => !!githubToken());
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function check(token: string | null) {
    setBusy(true);
    setMsg(null);
    try {
      if (demo) {
        setMsg({ ok: true, text: "2 PRs lidos · acesso: escrita" });
        return;
      }
      const r = await syncGithub(workspaceId, repo, token);
      setMsg({ ok: true, text: `${r.pulls} ${r.pulls === 1 ? "PR lido" : "PRs lidos"}${r.access ? ` · acesso: ${ACCESS_LABEL[r.access]}` : ""}` });
    } catch (e) {
      setMsg({ ok: false, text: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  }

  const btn = "rounded-md border border-line px-2 py-0.5 hover:bg-raised disabled:opacity-40";
  return (
    <div className="space-y-1 border-t border-line pt-2">
      <div className="flex items-center gap-1.5">
        <BrandIcon brand="github" size={13} />
        <span className="font-medium">PRs e CI</span>
        {access && <span className={`ml-auto text-[10.5px] ${access === "write" ? "text-muted" : "text-warn"}`}>seu acesso: {ACCESS_LABEL[access]}</span>}
      </div>
      {hasToken ? (
        <div className="flex items-center justify-end gap-1.5">
          <span className="mr-auto text-[10.5px] text-muted">Token do GitHub salvo nesta máquina</span>
          <button type="button" onClick={() => (setGithubToken(null), setHasToken(false), onSaved())} className="rounded-md px-2 py-0.5 text-muted hover:text-text">
            Remover
          </button>
          <button type="button" disabled={busy} onClick={() => void check(githubToken())} className={btn}>
            {busy ? "Lendo…" : "Ler agora"}
          </button>
        </div>
      ) : (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            setGithubToken(draft);
            setHasToken(true);
            setDraft("");
            onSaved();
            void check(draft.trim());
          }}
        >
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Token do GitHub (opcional)"
            aria-label="Token do GitHub"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-0.5 outline-none focus:border-accent"
          />
          <button disabled={!draft.trim()} className={btn}>
            Salvar
          </button>
        </form>
      )}
      {!hasToken && (
        <p className="text-[10.5px] leading-snug text-muted">
          Sem token, só repositório público.{" "}
          <a
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
            title="Fine-grained, só este repositório: Pull requests, Commit statuses e Checks em leitura"
          >
            Criar token
          </a>
        </p>
      )}
      {msg && <p className={`text-[10.5px] ${msg.ok ? "text-muted" : "text-danger"}`}>{msg.text}</p>}
    </div>
  );
}
