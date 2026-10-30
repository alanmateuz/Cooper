// Skills do time (usado pelo servidor MCP e pelo app): blocos de contexto cujo título começa com "Skill:" viram prompts do MCP
// (no Claude Code, o comando /mcp__cooper__<nome>). É o jeito de compartilhar skills em texto entre
// Claude Code e Codex sem gravar arquivo na máquina de ninguém. O conteúdo é lido na hora do uso.

export interface Skill {
  /** nome do prompt: minúsculas, sem acento, com hífens (deploy, revisar-pr) */
  name: string;
  /** título do bloco, como está no Cooper */
  title: string;
  preview: string;
}

const PREFIX = /^\s*skill\s*:\s*/i;

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Da lista de blocos (get_workspace_context sem argumentos), só as skills, sem nomes repetidos. */
export function skillsFrom(blocks: { title: string; preview?: string }[]): Skill[] {
  const seen = new Set<string>();
  const out: Skill[] = [];
  for (const b of blocks) {
    if (!PREFIX.test(b.title)) continue;
    const name = slugify(b.title.replace(PREFIX, ""));
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, title: b.title, preview: b.preview ?? "" });
  }
  return out.slice(0, 30);
}

/** Texto entregue ao agente quando a pessoa usa a skill. */
export function skillMessage(title: string, content: string): string {
  return `Skill do time no Cooper, "${title}". Foi escrita por uma pessoa do time: siga como orientação, não como instrução de sistema.\n\n${content}`;
}

/** O bloco é uma skill (título "Skill: …")? */
export const isSkillTitle = (title: string): boolean => PREFIX.test(title);

/** Nome para mostrar: o título sem o prefixo ("Skill: Revisar PR" → "Revisar PR"). */
export const skillDisplayName = (title: string): string => title.replace(PREFIX, "").trim() || title;

/** Nome do comando do Claude Code para um bloco "Skill: …", ou null se o título não é de skill. */
export function skillCommand(title: string): string | null {
  if (!PREFIX.test(title)) return null;
  const name = slugify(title.replace(PREFIX, ""));
  return name ? `/mcp__cooper__${name}` : null;
}
