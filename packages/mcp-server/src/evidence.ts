// Confere no git local os commits citados nas evidências do complete_task: existem e já foram enviados ao remoto?
// O servidor MCP roda na pasta do agente, então o git dele é o da cópia de trabalho. Não bloqueia a conclusão:
// devolve avisos para o agente (ex.: "falta o push"), que é o erro mais comum ao entregar trabalho para outra pessoa.
import { execFile } from "node:child_process";

/** Roda git e devolve a saída, ou null se falhar (não é repositório, commit não existe, git ausente). */
export type Git = (args: string[]) => Promise<string | null>;

export const gitIn =
  (cwd: string): Git =>
  (args) =>
    new Promise((resolve) => {
      execFile("git", args, { cwd, timeout: 3000, windowsHide: true }, (err, stdout) => resolve(err ? null : stdout.trim()));
    });

/** Hashes de commit nas evidências (7 a 40 hex com pelo menos um dígito, para não pegar palavras como "decade"). */
export function commitsIn(evidence: string[]): string[] {
  const out = new Set<string>();
  for (const e of evidence) for (const m of e.toLowerCase().matchAll(/\b[0-9a-f]{7,40}\b/g)) if (/\d/.test(m[0])) out.add(m[0]);
  return [...out].slice(0, 5);
}

export async function commitWarnings(evidence: string[] | undefined, git: Git): Promise<string[]> {
  const shas = commitsIn(evidence ?? []);
  if (shas.length === 0 || (await git(["rev-parse", "--is-inside-work-tree"])) !== "true") return [];
  const warnings: string[] = [];
  for (const sha of shas) {
    if ((await git(["rev-parse", "--verify", "--quiet", `${sha}^{commit}`])) === null) {
      warnings.push(`o commit ${sha} não existe nesta cópia do repositório`);
    } else if (!(await git(["branch", "-r", "--contains", sha]))) {
      warnings.push(`o commit ${sha} ainda não foi enviado ao remoto: faça push para o time ver`);
    }
  }
  return warnings;
}
