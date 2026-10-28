import { useCallback, useEffect, useState } from "react";
import { pref, setPref } from "./format";
import { supabase } from "./supabase";
import { inTauri } from "./window";

export interface Repository {
  id: string;
  workspace_id: string;
  owner: string;
  name: string;
  default_branch: string;
}

export interface GitStatus {
  remote: { owner: string; name: string } | null;
  branch: string | null;
  head_sha: string | null;
  ahead: number | null;
  behind: number | null;
  dirty_files_count: number;
}

/** Pasta da cópia local, por projeto. Fica só nesta máquina: o caminho nunca vai para o servidor. */
export const repoPath = (workspaceId: string) => pref<string | null>(`repoPath.${workspaceId}`, null);
export const setRepoPath = (workspaceId: string, path: string | null) => setPref(`repoPath.${workspaceId}`, path);

export async function gitStatus(path: string): Promise<GitStatus> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<GitStatus>("git_repo_status", { path });
}

export const sameRepo = (r: Repository, s: GitStatus) =>
  !!s.remote && s.remote.owner.toLowerCase() === r.owner.toLowerCase() && s.remote.name.toLowerCase() === r.name.toLowerCase();

/** Envia o estado do git (branch, sha, à frente/atrás, quantos alterados; nunca nomes de arquivo). */
export async function pushSnapshot(workspaceId: string, repo: Repository, s: GitStatus) {
  const { error } = await supabase.from("git_snapshots").upsert(
    {
      workspace_id: workspaceId,
      repository_id: repo.id,
      branch: s.branch,
      head_sha: s.head_sha,
      ahead: s.ahead,
      behind: s.behind,
      dirty_files_count: s.dirty_files_count,
      dirty_files: null,
      observed_at: new Date().toISOString(),
    },
    { onConflict: "user_id,repository_id" },
  );
  if (error) throw error;
}

const EVERY_MS = 60_000;

/** No app desktop, com a pasta escolhida e do repositório do time: manda o estado do git a cada minuto. */
export function useGitSync(workspaceId: string | null, repo: Repository | null, version: number) {
  useEffect(() => {
    if (!inTauri || !workspaceId || !repo) return;
    const path = repoPath(workspaceId);
    if (!path) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await gitStatus(path);
        if (!stop && sameRepo(repo, s)) await pushSnapshot(workspaceId, repo, s);
      } catch {
        /* pasta sumiu ou sem rede: tenta de novo no próximo minuto */
      }
    };
    void tick();
    const id = setInterval(tick, EVERY_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [workspaceId, repo, version]);
}

/** Repositório do time (um por projeto, escolhido pelo dono). */
export function useTeamRepo(workspaceId: string | null) {
  const [repo, setRepo] = useState<Repository | null>(null);
  const reload = useCallback(async () => {
    if (!workspaceId) return setRepo(null);
    const { data } = await supabase.from("repositories").select("*").eq("workspace_id", workspaceId).order("created_at").limit(1);
    setRepo(((data ?? [])[0] as Repository | undefined) ?? null);
  }, [workspaceId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { repo, reload };
}
