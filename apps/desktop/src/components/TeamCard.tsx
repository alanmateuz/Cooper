import { AGENT_LABELS, LIMIT_STALE_MS, PRESENCE_LABELS, type UsageView } from "@cooper/shared";
import { useState } from "react";
import { friendlyError } from "../lib/errors";
import { shortSha, timeAgo } from "../lib/format";
import { shortName } from "../lib/names";
import type { PersonView } from "../lib/people";
import { Avatar, Icon } from "./ui";
import { useFlash } from "../lib/motion";

/**
 * Cartão de uma pessoa na aba Agora. Ordem de leitura:
 * 1. quem é; 2. em que está trabalhando (na cor da pessoa); 3. limites, uma linha por agente; 4. branch.
 * Detalhes secundários (tokens, reinício, hora da leitura, sha) ficam no título, para o cartão não pesar.
 */
export function TeamCard({
  p,
  now,
  isMe,
  usage,
  onRefreshClaude,
}: {
  p: PersonView;
  now: Date;
  isMe: boolean;
  usage: UsageView[];
  /** só no meu cartão, no app desktop: lê os limites do Claude Code em segundo plano */
  onRefreshClaude?: () => Promise<void>;
}) {
  const s = p.session;
  // brilho rápido quando muda o que a pessoa está fazendo ou o limite dela
  const flash = useFlash(`${p.task?.id ?? ""}|${s?.activity_text ?? ""}|${usage.map((u) => Math.round(u.primary?.pct ?? -1)).join(",")}`);
  const snap = p.snapshot;
  // a tarefa leva a cor da pessoa, um pouco misturada ao texto para continuar legível nos dois temas
  const personColor = `color-mix(in oklch, ${p.profile.avatar_color} 75%, var(--text))`;

  return (
    <article id={`card-${p.userId}`} className={`anim-in scroll-mt-2 rounded-xl border border-line bg-panel p-3 ${flash}`}>
      <header className="flex items-center gap-2">
        <Avatar name={p.profile.display_name} color={p.profile.avatar_color} status={p.presence} size={26} />
        <span className="truncate text-[13px] font-semibold">{shortName(p.profile.display_name)}</span>
        {isMe && <span className="shrink-0 text-[10.5px] text-muted">você</span>}
        <span
          className="ml-auto shrink-0 text-[10.5px] text-muted"
          title={`${PRESENCE_LABELS[p.presence]}${p.lastSeenAt ? ` · visto em ${new Date(p.lastSeenAt).toLocaleString("pt-BR")}` : ""}`}
        >
          {p.presence === "running" ? <span className="font-medium text-run">executando</span> : p.lastSeenAt ? timeAgo(p.lastSeenAt, now) : ""}
        </span>
      </header>

      {/* trabalho atual: o que mais importa, em destaque e na cor da pessoa */}
      <section className="mt-2">
        {p.task ? (
          <>
            <p className="truncate text-[13px] font-semibold" style={{ color: personColor }} title={`#${p.task.number} ${p.task.title}`}>
              {p.task.title}
            </p>
            {s?.activity_text && (
              <p className="mt-0.5 truncate text-[11.5px] text-muted" title={`${s.activity_text} (declarado pelo agente)`}>
                {s.activity_text}
              </p>
            )}
          </>
        ) : (
          <p className="text-[11.5px] text-muted">Sem tarefa em andamento</p>
        )}
      </section>

      {/* limites: uma linha por agente */}
      {(usage.length > 0 || onRefreshClaude) && (
        <section className="mt-2.5 space-y-1.5 border-t border-line pt-2">
          {usage.map((u) => (
            <AgentUsage key={u.agent} u={u} now={now} isMe={isMe} onRefresh={u.agent === "claude_code" ? onRefreshClaude : undefined} />
          ))}
          {!usage.some((u) => u.agent === "claude_code") && onRefreshClaude && <AgentUsage u={null} now={now} isMe onRefresh={onRefreshClaude} />}
        </section>
      )}
      {usage.length === 0 && !onRefreshClaude && (
        <p className="mt-2 text-[10.5px] text-muted">{isMe ? "Uso de IA: só no app desktop" : "Uso de IA não compartilhado"}</p>
      )}

      {/* git: uma linha discreta */}
      {snap && (
        <footer className="mt-2 flex items-center gap-1.5 text-[10.5px] text-muted">
          <Icon name="branch" size={11} />
          <span className="min-w-0 flex-1 truncate" title={`git local${snap.head_sha ? ` · ${shortSha(snap.head_sha)}` : ""}`}>
            {snap.branch ?? "HEAD destacado"}
          </span>
          {snap.dirty_files_count > 0 && (
            <span className="shrink-0">
              {snap.dirty_files_count} {snap.dirty_files_count === 1 ? "alteração" : "alterações"}
            </span>
          )}
          {snap.behind ? <span className="shrink-0 text-warn">{snap.behind} atrás</span> : null}
        </footer>
      )}
    </article>
  );
}

const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("pt-BR");

/** "em 1 h 24 min" quando é hoje/em breve; "ter 14:57" quando é mais longe. */
function resetLabel(at: Date, now: Date): string {
  const min = Math.round((at.getTime() - now.getTime()) / 60_000);
  if (min <= 0) return "agora";
  if (min < 60) return `em ${min} min`;
  if (min < 12 * 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `em ${h} h ${m} min` : `em ${h} h`;
  }
  const time = at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${at.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")} ${time}`;
}

export const tone = (pct: number) => (pct >= 90 ? "danger" : pct >= 70 ? "warn" : "ok");
export const BAR = { ok: "bg-muted", warn: "bg-warn", danger: "bg-danger" } as const;
export const TEXT = { ok: "text-text", warn: "text-warn", danger: "text-danger" } as const;

/** Limite mais apertado da pessoa entre os agentes (o de 5 h acaba primeiro; sem ele, o da semana). */
export function peakLimit(usage: UsageView[]): { pct: number; label: "5 h" | "semana" } | null {
  const five = usage.map((u) => u.primary?.pct).filter((x): x is number => x != null);
  if (five.length) return { pct: Math.max(...five), label: "5 h" };
  const week = usage.map((u) => u.secondary?.pct).filter((x): x is number => x != null);
  return week.length ? { pct: Math.max(...week), label: "semana" } : null;
}

/** Um agente numa linha: nome, 5 h e semana. Tokens, reinício e hora da leitura ficam no título. */
function AgentUsage({ u, now, isMe, onRefresh }: { u: UsageView | null; now: Date; isMe: boolean; onRefresh?: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const at = u?.limitsObservedAt ?? null;
  const stale = !!at && now.getTime() - at.getTime() > LIMIT_STALE_MS;
  const hasLimits = !!(u?.primary || u?.secondary);
  const info = [
    u && `${compact.format(u.totalTokens)} tokens hoje (entrada ${full.format(u.tokens.input)} · saída ${full.format(u.tokens.output)})`,
    at && `limites lidos ${timeAgo(at.toISOString(), now)}`,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div>
      <div className="flex items-center gap-2 text-[11px]">
        <span className="w-[4.6rem] shrink-0 truncate text-muted" title={info || undefined}>
          {AGENT_LABELS[u?.agent ?? "claude_code"]}
        </span>
        {hasLimits ? (
          <div className={`grid min-w-0 flex-1 grid-cols-2 gap-2.5 ${stale ? "opacity-60" : ""}`}>
            {u!.primary ? <Meter label="5 h" pct={u!.primary.pct} reset={resetLabel(u!.primary.resetsAt, now)} /> : <span />}
            {u!.secondary ? <Meter label="sem" pct={u!.secondary.pct} reset={resetLabel(u!.secondary.resetsAt, now)} /> : <span />}
          </div>
        ) : (
          <span className="flex-1 text-[10.5px] text-muted">{u ? "limite não informado" : "limite ainda não lido"}</span>
        )}
        {stale && (
          <span className="shrink-0 text-warn" title={`Limites lidos ${timeAgo(at!.toISOString(), now)}: podem estar desatualizados`}>
            ⚠
          </span>
        )}
        {onRefresh && isMe && (
          <button
            type="button"
            disabled={busy}
            aria-label="Atualizar limites do Claude Code"
            onClick={() => {
              setBusy(true);
              setErr(null);
              onRefresh()
                .catch((e) => setErr(friendlyError(e)))
                .finally(() => setBusy(false));
            }}
            className={`shrink-0 rounded px-1 text-muted hover:bg-raised hover:text-text disabled:opacity-50 ${busy ? "animate-spin" : ""}`}
            title="Roda o Claude Code em segundo plano (uma mensagem curta no Haiku) para ler os limites"
          >
            ↻
          </button>
        )}
      </div>
      {err && (
        <p className="mt-0.5 truncate text-[10px] text-danger" title={err}>
          {err}
        </p>
      )}
    </div>
  );
}

/** Medidor compacto: rótulo, barra e percentual; quando reinicia fica no título. */
function Meter({ label, pct, reset }: { label: string; pct: number; reset: string }) {
  const t = tone(pct);
  return (
    <div className="flex min-w-0 items-center gap-1.5" title={`${label === "sem" ? "Semana" : "5 horas"}: ${Math.round(pct)}% do limite usado; reinicia ${reset}`}>
      <span className="shrink-0 text-[10px] text-muted">{label}</span>
      <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-raised" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`limite ${label}`}>
        <div className={`h-full rounded-full transition-[width] duration-700 ease-out ${BAR[t]}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
      </div>
      <span className={`w-7 shrink-0 text-right font-semibold tabular-nums ${TEXT[t]}`}>{Math.round(pct)}%</span>
    </div>
  );
}
