import { AGENT_LABELS, type AgentKind } from "./enums.js";

/**
 * "Colar contexto": divide um texto grande em blocos pelos títulos Markdown (#, ## ou ###).
 * Texto antes do primeiro título (ou texto sem títulos) vira o bloco "Resumo".
 */
export function splitContext(text: string): { title: string; content: string }[] {
  const blocks: { title: string; content: string[] }[] = [];
  let current: { title: string; content: string[] } | null = null;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const h = /^#{1,3}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      current = { title: h[1]!.slice(0, 120), content: [] };
      blocks.push(current);
    } else {
      if (!current) {
        current = { title: "Resumo", content: [] };
        blocks.push(current);
      }
      current.content.push(line);
    }
  }
  // títulos repetidos no texto colado: junta no primeiro
  const merged = new Map<string, { title: string; content: string[] }>();
  for (const b of blocks) {
    const key = b.title.toLowerCase();
    const prev = merged.get(key);
    if (prev) prev.content.push("", ...b.content);
    else merged.set(key, { title: b.title, content: [...b.content] });
  }
  return [...merged.values()]
    .map((b) => ({ title: b.title, content: b.content.join("\n").trim() }))
    .filter((b) => b.content.length > 0 || b.title !== "Resumo");
}

/** "Codex do Ian", "Bia" — quem escreveu um bloco ou versão. */
export function authorLabel(name: string, agent: AgentKind | null): string {
  return agent ? `${AGENT_LABELS[agent]} de ${name}` : name;
}
