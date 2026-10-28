#!/usr/bin/env node
// Hook do Claude Code para o Cooper: avisa que o agente está trabalhando ("Executando").
// O Claude Code passa um JSON do evento no stdin; daqui sai só o NOME do evento (pre_tool_use, stop…).
// Prompt, ferramenta, arquivos e caminhos do JSON são descartados. A conexão (url, chave pública e token
// do agente) vem de ~/.cooper/hook.json, gravado pelo app ao ligar os hooks.
// Nunca atrapalha o Claude Code: qualquer erro é ignorado, sai sempre com código 0 e espera no máximo 2 s.
// Referência: https://code.claude.com/docs/en/hooks (hook_event_name)
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

async function main() {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const event = eventOf(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
  if (!event) return;

  const lastFile = join(cooperDir(), "hook-last.json");
  let last: { event?: string; at?: number } | null = null;
  try {
    last = JSON.parse(readFileSync(lastFile, "utf8"));
  } catch {
    /* primeira vez */
  }
  if (!shouldSend(event, last)) return;

  const cfg = JSON.parse(readFileSync(join(cooperDir(), "hook.json"), "utf8")) as { url: string; anon: string; token: string };
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
