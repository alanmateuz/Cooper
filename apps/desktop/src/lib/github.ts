// Integração com o GitHub: o app lê os PRs do repositório do time (estado, CI, revisão) e o acesso desta pessoa,
// e entrega ao servidor pela RPC github_sync. O token é opcional e fica só nesta máquina (localStorage);
// sem token funciona para repositório público, mas não dá para saber o acesso de escrita.
import { useEffect } from "react";
import { pref, setPref } from "./format";
import type { Repository } from "./repo";

export const githubToken = () => pref<string | null>("githubToken", null);
export const setGithubToken = (t: string | null) => setPref("githubToken", t?.trim() || null);

export type Checks = "success" | "failure" | "pending" | "none";
export type Review = "approved" | "changes_requested" | "pending" | null;
export type Access = "write" | "read" | "none";

export interface PullRow {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  head_branch: string;
  base_branch: string;
  head_sha: string | null;
  author: string | null;
  checks: Checks;
  review: Review;
  url: string;
  updated_at: string;
}

// ───────────── leitura das respostas da API (funções puras, testadas em github.test.ts) ─────────────

interface ApiPull {
  number: number;
  title: string;
  state: "open" | "closed";
  draft?: boolean;
  merged_at: string | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  user: { login: string } | null;
  html_url: string;
  updated_at: string;
  requested_reviewers?: unknown[];
}
interface ApiCheckRun {
  status: string;
  conclusion: string | null;
}
interface ApiStatus {
  state: "success" | "failure" | "error" | "pending";
  total_count: number;
}
interface ApiReview {
  user: { login: string } | null;
  state: string;
}

/** Junta check runs (Actions) e commit statuses num resultado só: falha vence, depois rodando, depois sucesso. */
export function combineChecks(runs: ApiCheckRun[], status: ApiStatus | null): Checks {
  const results: Checks[] = runs.map((r) =>
    r.status !== "completed" ? "pending" : ["failure", "timed_out", "cancelled", "action_required"].includes(r.conclusion ?? "") ? "failure" : "success",
  );
  if (status && status.total_count > 0) results.push(status.state === "error" ? "failure" : status.state);
  if (results.includes("failure")) return "failure";
  if (results.includes("pending")) return "pending";
  return results.length ? "success" : "none";
}

/** Revisão: a última de cada pessoa conta; mudança pedida vence aprovação. Sem revisão, "pendente" se alguém foi chamado. */
export function combineReviews(reviews: ApiReview[], requested: number): Review {
  const last = new Map<string, string>();
  for (const r of reviews) if (r.user && ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(r.state)) last.set(r.user.login, r.state);
  const states = [...last.values()];
  if (states.includes("CHANGES_REQUESTED")) return "changes_requested";
  if (states.includes("APPROVED")) return "approved";
  return requested > 0 ? "pending" : null;
}

export function toRow(p: ApiPull, checks: Checks, review: Review): PullRow {
  return {
    number: p.number,
    title: p.title.slice(0, 300),
    state: p.merged_at ? "merged" : p.state,
    draft: !!p.draft,
    head_branch: p.head.ref,
    base_branch: p.base.ref,
    head_sha: /^[0-9a-f]{40}$/.test(p.head.sha) ? p.head.sha : null,
    author: p.user?.login ?? null,
    checks,
    review,
    url: p.html_url,
    updated_at: p.updated_at,
  };
}

/** Acesso pelo campo permissions de GET /repos (só vem com token). */
export function accessFrom(repo: { permissions?: { push?: boolean; pull?: boolean } } | null): Access | null {
  if (!repo?.permissions) return null;
  return repo.permissions.push ? "write" : repo.permissions.pull ? "read" : "none";
}

// ───────────── chamadas ─────────────

const RECENT_MS = 7 * 24 * 3600_000;

export class GithubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(path: string, token: string | null): Promise<T> {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!r.ok) {
    const msg =
      r.status === 401 ? "token do GitHub inválido ou vencido"
      : r.status === 403 ? "o GitHub limitou as consultas (sem token são 60 por hora)"
      : r.status === 404 ? "repositório não encontrado (privado? precisa de token com acesso a ele)"
      : `GitHub respondeu ${r.status}`;
    throw new GithubError(r.status, msg);
  }
  return (await r.json()) as T;
}

/** Lê o GitHub: PRs abertos e os fechados na última semana (com CI e revisão dos abertos) e o acesso desta pessoa. */
export async function readGithub(repo: Repository, token: string | null): Promise<{ pulls: PullRow[]; access: Access | null }> {
  const base = `/repos/${repo.owner}/${repo.name}`;
  let access: Access | null = null;
  if (token) {
    try {
      access = accessFrom(await api(base, token));
    } catch (e) {
      if (e instanceof GithubError && e.status === 404) access = "none";
      else throw e;
    }
    if (access === "none") return { pulls: [], access };
  }
  const list = await api<ApiPull[]>(`${base}/pulls?state=all&sort=updated&direction=desc&per_page=20`, token);
  const now = Date.now();
  const relevant = list.filter((p) => p.state === "open" || now - new Date(p.updated_at).getTime() < RECENT_MS);
  const pulls = await Promise.all(
    relevant.map(async (p) => {
      if (p.state !== "open") return toRow(p, "none", null);
      const [runs, status, reviews] = await Promise.all([
        api<{ check_runs: ApiCheckRun[] }>(`${base}/commits/${p.head.sha}/check-runs?per_page=50`, token).then((x) => x.check_runs, () => []),
        api<ApiStatus>(`${base}/commits/${p.head.sha}/status`, token).catch(() => null),
        api<ApiReview[]>(`${base}/pulls/${p.number}/reviews?per_page=50`, token).catch(() => []),
      ]);
      return toRow(p, combineChecks(runs, status), combineReviews(reviews, p.requested_reviewers?.length ?? 0));
    }),
  );
  return { pulls, access };
}

export async function syncGithub(workspaceId: string, repo: Repository, token: string | null) {
  const { pulls, access } = await readGithub(repo, token);
  // importado aqui para as funções puras deste módulo serem testáveis sem a configuração do servidor
  const { supabase } = await import("./supabase");
  const { error } = await supabase.rpc("github_sync", { p_workspace: workspaceId, p_prs: pulls, p_access: access });
  if (error) throw error;
  return { pulls: pulls.length, access };
}

/** Com token, a cada 2 min; sem token, a cada 10 (o GitHub permite 60 consultas por hora sem token). */
export function useGithubSync(workspaceId: string | null, repo: Repository | null, version: number) {
  useEffect(() => {
    if (!workspaceId || !repo) return;
    const token = githubToken();
    let stop = false;
    const tick = () => {
      if (!stop) void syncGithub(workspaceId, repo, token).catch(() => {
        /* sem rede, limite do GitHub ou servidor sem o esquema 20: tenta de novo no próximo ciclo */
      });
    };
    tick();
    const id = setInterval(tick, token ? 2 * 60_000 : 10 * 60_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [workspaceId, repo, version]);
}
