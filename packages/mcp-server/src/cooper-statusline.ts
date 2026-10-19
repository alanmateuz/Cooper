#!/usr/bin/env node
// Status line do Claude Code para o Cooper.
// O Claude Code passa um JSON da sessão no stdin; daqui só saem os limites da assinatura
// (rate_limits.five_hour / seven_day: percentual e reinício), gravados em ~/.cooper/claude-limits.json
// para o app desktop ler. Nenhum outro campo (caminhos, modelo, custo, sessão) é guardado.
// Se a pessoa já tinha uma status line, ela continua: o mesmo JSON é repassado e a saída dela é impressa.
// Referência: https://code.claude.com/docs/en/statusline (campos rate_limits.*)
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Window {
  used_percentage: number;
  resets_at: number;
}
export interface ClaudeLimits {
  five_hour: Window | null;
  seven_day: Window | null;
  observed_at: number;
}

const cooperDir = () => process.env.COOPER_HOME || join(homedir(), ".cooper");

function win(v: unknown): Window | null {
  if (!v || typeof v !== "object") return null;
  const { used_percentage: p, resets_at: r } = v as Record<string, unknown>;
  if (typeof p !== "number" || typeof r !== "number" || !Number.isFinite(p) || !Number.isFinite(r)) return null;
  return { used_percentage: Math.min(100, Math.max(0, p)), resets_at: Math.trunc(r) };
}

/** Só números saem daqui: tudo o que não for os dois limites é descartado. */
export function extractLimits(input: unknown, now = Date.now()): ClaudeLimits | null {
  const rl = input && typeof input === "object" ? (input as Record<string, unknown>).rate_limits : null;
  if (!rl || typeof rl !== "object") return null;
  const r = rl as Record<string, unknown>;
  const limits = { five_hour: win(r.five_hour), seven_day: win(r.seven_day), observed_at: now };
  return limits.five_hour || limits.seven_day ? limits : null;
}

function writeJson(name: string, value: unknown) {
  const dir = cooperDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, file);
}

/** Status line que a pessoa já usava antes do Cooper (gravada pelo app ao instalar). */
function previousCommand(): string | null {
  try {
    const cfg = JSON.parse(readFileSync(join(cooperDir(), "statusline.json"), "utf8")) as { previous?: { command?: unknown } };
    return typeof cfg.previous?.command === "string" && cfg.previous.command.trim() ? cfg.previous.command : null;
  } catch {
    return null;
  }
}

function ownLine(input: Record<string, unknown>, limits: ClaudeLimits | null): string {
  const model = (input.model as { display_name?: unknown } | undefined)?.display_name;
  const parts = [typeof model === "string" ? model : "Claude Code"];
  if (limits?.five_hour) parts.push(`5h ${Math.round(limits.five_hour.used_percentage)}%`);
  if (limits?.seven_day) parts.push(`semana ${Math.round(limits.seven_day.used_percentage)}%`);
  return parts.join(" · ");
}

async function main() {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  let input: Record<string, unknown> = {};
  try {
    input = JSON.parse(raw);
  } catch {
    // JSON inesperado: não grava nada e mostra uma linha neutra
  }
  const limits = extractLimits(input);
  try {
    // diagnóstico: quando rodou e se o Claude Code mandou limites (só horário e sim/não)
    writeJson("statusline-seen.json", { at: Date.now(), rate_limits: limits !== null });
    if (limits) writeJson("claude-limits.json", limits);
  } catch {
    // sem permissão de escrita: a status line continua funcionando
  }
  const prev = previousCommand();
  if (prev) {
    const r = spawnSync(prev, { input: raw, shell: true, encoding: "utf8", timeout: 5000 });
    process.stdout.write(r.stdout ?? "");
    return;
  }
  process.stdout.write(`${ownLine(input, limits)}\n`);
}

if (process.argv[1] && /cooper-statusline\.(js|ts)$/.test(process.argv[1])) void main();
