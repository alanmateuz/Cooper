#!/usr/bin/env node
// Hook do Claude Code e do Codex para o Cooper: avisa que o agente está trabalhando ("Executando").
// O agente passa um JSON do evento no stdin (mesmo formato nos dois); daqui sai só o NOME do evento (pre_tool_use, stop…).
// Prompt, ferramenta, arquivos e caminhos do JSON não saem da máquina. Com a revisão humana ligada, o comando
// de terminal é olhado aqui mesmo para barrar aprovação ou merge de PR (código de saída 2).
// Fora isso, nada do JSON é usado. A conexão (url, chave pública e token
// do agente) vem de ~/.cooper/hook-<agente>.json, gravado pelo app ao ligar os hooks; o agente vem no 1º argumento.
// Nunca atrapalha o agente: qualquer erro é ignorado, sai com código 0 (ou 2 só para barrar PR) e espera no máximo 2 s.
// Referências: https://code.claude.com/docs/en/hooks e https://learn.chatgpt.com/docs/hooks (hook_event_name)
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EVENTS: Record<string, string> = {
  UserPromptSubmit: "user_prompt_submit",
  PreToolUse: "pre_tool_use",
  PostToolUse: "post_tool_use",
  Stop: "stop",
};
/** Mesmo evento repetido dentro desta janela não é reenviado (um PreToolUse por ferramenta seria demais). */
const THROTTLE_MS = 20_000;

const cooperDir = () => process.env.COOPER_HOME || join(homedir(), ".cooper");

/** Só o nome do evento, já traduzido; qualquer outro campo é ignorado. */
export function eventOf(input: unknown): string | null {
  const name = input && typeof input === "object" ? (input as Record<string, unknown>).hook_event_name : null;
  return typeof name === "string" ? (EVENTS[name] ?? null) : null;
}

/** Repetir o mesmo evento logo em seguida não muda a presença; "stop" sempre passa. */
export function shouldSend(event: string, last: { event?: string; at?: number } | null, now = Date.now()): boolean {
  return event === "stop" || !last || last.event !== event || now - (last.at ?? 0) > THROTTLE_MS;
}

/** Agente do 1º argumento; sem argumento (versões antigas do hook), Claude Code. */
export function agentOf(arg: string | undefined): "claude_code" | "codex" {
  return arg === "codex" ? "codex" : "claude_code";
}

/** Comando que aprova ou faz merge de um PR no GitHub (gh pr merge, gh pr review --approve, API de merge). */
export function approvesPr(command: string): boolean {
  const c = command.replace(/\s+/g, " ");
  return (
    /\bgh pr merge\b/.test(c) ||
    (/\bgh pr review\b/.test(c) && /(--approve|(^|\s)-a(\s|$))/.test(c)) ||
    /\bgh api\b.*\/pulls\/\d+\/merge\b/.test(c)
  );
}

/** Comando de terminal do evento (Claude Code: Bash; Codex: shell), ou null. Fica só nesta máquina. */
export function commandOf(input: unknown): string | null {
  const ti = input && typeof input === "object" ? (input as Record<string, unknown>).tool_input : null;
  const cmd = ti && typeof ti === "object" ? (ti as Record<string, unknown>).command : null;
  if (typeof cmd === "string") return cmd;
  return Array.isArray(cmd) && cmd.every((x) => typeof x === "string") ? cmd.join(" ") : null;
}

/** Política do projeto, gravada pelo app em ~/.cooper/hook-policy.json. */
function blockPrApproval(): boolean {
  try {
    return JSON.parse(readFileSync(join(cooperDir(), "hook-policy.json"), "utf8")).block_pr_approval === true;
  } catch {
    return false;
  }
}

async function main() {
  const agent = agentOf(process.argv[2]);
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  const event = eventOf(input);
  if (!event) return;

  // Revisão humana ligada: o agente não aprova nem faz merge de PR. Verificado aqui, sem enviar o comando a ninguém.
  if (event === "pre_tool_use") {
    const cmd = commandOf(input);
    if (cmd && approvesPr(cmd) && blockPrApproval()) {
      process.stderr.write("Cooper: neste projeto só uma pessoa aprova ou faz merge de PRs. Peça a revisão ao usuário em vez de aprovar.\n");
      process.exit(2); // código 2 = bloquear a ferramenta (Claude Code e Codex)
    }
  }

  const lastFile = join(cooperDir(), `hook-last-${agent}.json`);
  let last: { event?: string; at?: number } | null = null;
  try {
    last = JSON.parse(readFileSync(lastFile, "utf8"));
  } catch {
    /* primeira vez */
  }
  if (!shouldSend(event, last)) return;

  const cfg = JSON.parse(readFileSync(join(cooperDir(), `hook-${agent}.json`), "utf8")) as { url: string; anon: string; token: string };
  await fetch(`${cfg.url}/rest/v1/rpc/mcp_hook_event`, {
    method: "POST",
    headers: { apikey: cfg.anon, Authorization: `Bearer ${cfg.anon}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: cfg.token, p_event: event }),
    signal: AbortSignal.timeout(2000),
  });
  writeFileSync(lastFile, JSON.stringify({ event, at: Date.now() }));
}

if (process.argv[1] && /cooper-hook/.test(process.argv[1])) {
  main()
    .catch(() => {})
    .finally(() => process.exit(0));
}
