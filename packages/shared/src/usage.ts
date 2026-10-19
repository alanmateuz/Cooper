import { z } from "zod";
import type { AgentKind } from "./enums.js";

// Uso de IA: o app desktop lê os JSONL localmente (Rust, apps/desktop/src-tauri/src/ai_usage.rs)
// e, só se a pessoa ligar o compartilhamento, envia estas linhas. Apenas números e nome do modelo.

export interface UsageTokens {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}
export interface UsageLimit {
  used_pct: number;
  window_minutes: number | null;
  /** epoch em segundos */
  resets_at: number;
}
export interface AgentUsageReport {
  tokens: UsageTokens;
  models: string[];
  primary: UsageLimit | null;
  secondary: UsageLimit | null;
  last_event_at: number | null;
}
/** Resposta do comando `read_ai_usage`. */
export interface UsageReport {
  claude_code: AgentUsageReport | null;
  codex: AgentUsageReport | null;
}

const MODEL = /^[A-Za-z0-9._:-]{1,80}$/;
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const pct = z.number().min(0).max(100).nullable();
const iso = z.string().datetime({ offset: true }).nullable();

/** Linha de ai_usage como o widget grava. `.strict()`: qualquer campo a mais (texto) é recusado. */
export const aiUsageRowSchema = z
  .object({
    workspace_id: z.string().uuid(),
    user_id: z.string().uuid(),
    agent_kind: z.enum(["claude_code", "codex"]),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    input_tokens: count,
    output_tokens: count,
    cache_read_tokens: count,
    cache_write_tokens: count,
    models: z.array(z.string().regex(MODEL)).max(10),
    primary_used_pct: pct,
    primary_window_minutes: z.number().int().positive().nullable(),
    primary_resets_at: iso,
    secondary_used_pct: pct,
    secondary_window_minutes: z.number().int().positive().nullable(),
    secondary_resets_at: iso,
    observed_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type AiUsageRow = z.infer<typeof aiUsageRowSchema>;

const toIso = (s: number | null | undefined) => (s ? new Date(s * 1000).toISOString() : null);

/** Monta as linhas a enviar, uma por agente com dados. Campos copiados um a um: nada além disso sai. */
export function usageRows(report: UsageReport, workspaceId: string, userId: string, day: string, now = new Date()): AiUsageRow[] {
  const rows: AiUsageRow[] = [];
  for (const agent of ["claude_code", "codex"] as const) {
    const u = report[agent];
    if (!u) continue;
    rows.push(
      aiUsageRowSchema.parse({
        workspace_id: workspaceId,
        user_id: userId,
        agent_kind: agent,
        day,
        input_tokens: Math.round(u.tokens.input),
        output_tokens: Math.round(u.tokens.output),
        cache_read_tokens: Math.round(u.tokens.cache_read),
        cache_write_tokens: Math.round(u.tokens.cache_write),
        models: u.models.filter((m) => MODEL.test(m)).slice(0, 10),
        primary_used_pct: u.primary?.used_pct ?? null,
        primary_window_minutes: u.primary?.window_minutes ?? null,
        primary_resets_at: toIso(u.primary?.resets_at),
        secondary_used_pct: u.secondary?.used_pct ?? null,
        secondary_window_minutes: u.secondary?.window_minutes ?? null,
        secondary_resets_at: toIso(u.secondary?.resets_at),
        observed_at: now.toISOString(),
      }),
    );
  }
  return rows;
}

/** O que o cartão mostra, venha do leitor local (meu cartão) ou do banco (cartão do outro). */
export interface UsageView {
  agent: AgentKind;
  totalTokens: number;
  tokens: UsageTokens;
  models: string[];
  primary: { pct: number; resetsAt: Date; windowMinutes: number | null } | null;
  secondary: { pct: number; resetsAt: Date; windowMinutes: number | null } | null;
}

const total = (t: UsageTokens) => t.input + t.output + t.cache_read + t.cache_write;

export function viewsFromReport(r: UsageReport | null): UsageView[] {
  if (!r) return [];
  return (["claude_code", "codex"] as const).flatMap((agent) => {
    const u = r[agent];
    if (!u) return [];
    const lim = (l: UsageLimit | null) => (l ? { pct: l.used_pct, resetsAt: new Date(l.resets_at * 1000), windowMinutes: l.window_minutes } : null);
    return [{ agent, totalTokens: total(u.tokens), tokens: u.tokens, models: u.models, primary: lim(u.primary), secondary: lim(u.secondary) }];
  });
}

/** Linhas do banco → visão; descarta dia diferente de `today` e limites cujo reinício já passou. */
export function viewsFromRows(rows: AiUsageRow[], today: string, now: Date): UsageView[] {
  return rows
    .filter((r) => r.day === today)
    .map((r) => {
      const tokens = { input: Number(r.input_tokens), output: Number(r.output_tokens), cache_read: Number(r.cache_read_tokens), cache_write: Number(r.cache_write_tokens) };
      const lim = (pct: number | null, at: string | null, w: number | null) =>
        pct == null || !at || new Date(at) <= now ? null : { pct: Number(pct), resetsAt: new Date(at), windowMinutes: w };
      return {
        agent: r.agent_kind,
        totalTokens: total(tokens),
        tokens,
        models: r.models,
        primary: lim(r.primary_used_pct, r.primary_resets_at, r.primary_window_minutes),
        secondary: lim(r.secondary_used_pct, r.secondary_resets_at, r.secondary_window_minutes),
      };
    });
}

/** Data local AAAA-MM-DD e o início do dia (ms), usados para "uso do dia". */
export function localDay(now = new Date()): { day: string; startMs: number } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const p = (n: number) => String(n).padStart(2, "0");
  return { day: `${start.getFullYear()}-${p(start.getMonth() + 1)}-${p(start.getDate())}`, startMs: start.getTime() };
}
