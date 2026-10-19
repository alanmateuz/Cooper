import { AGENT_LABELS, LIMIT_STALE_MS, PRESENCE_LABELS, type AgentKind, type UsageView } from "@cooper/shared";
import { useState } from "react";
import { shortSha, timeAgo } from "../lib/format";
import type { PersonView } from "../lib/people";
import { Avatar, Icon, SourceBadge } from "./ui";

/**
 * Cartão de uma pessoa na aba Agora. Ordem de leitura:
 * 1. quem é e quando foi visto; 2. em que está trabalhando; 3. quanto de limite de IA ainda tem; 4. detalhes (git).
 * Estados sem informação útil (presença desconhecida, sem git) não ocupam linha.
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
  const snap = p.snapshot;
  const agents = [...new Set<AgentKind>([...(s ? [s.agent_kind] : []), ...p.otherSessions.map((o) => o.session.agent_kind), ...usage.map((u) => u.agent)])];
  const showPresence = p.presence === "running" || p.presence === "online";

  return (
    <article className="rounded-xl border border-line bg-panel p-3">
      <header className="flex items-center gap-2.5">
        <Avatar name={p.profile.display_name} color={p.profile.avatar_color} status={p.presence} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-[13px] font-semibold">{p.profile.display_name.replace(/\s*\(.*\)/, "")}</span>
            {isMe && <span className="shrink-0 text-[10.5px] text-muted">você</span>}
            <span className="ml-auto shrink-0 text-[10.5px] text-muted" title={p.lastSeenAt ? new Date(p.lastSeenAt).toLocaleString("pt-BR") : undefined}>
              {p.lastSeenAt ? timeAgo(p.lastSeenAt, now) : ""}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {showPresence && (
              <span className={`text-[10.5px] font-medium ${p.presence === "running" ? "text-run" : "text-online"}`}>{PRESENCE_LABELS[p.presence]}</span>
            )}
            {agents.map((a) => (
              <span key={a} className="rounded-full bg-raised px-1.5 py-px text-[10px] text-muted">
                {AGENT_LABELS[a]}
              </span>
            ))}
            {agents.length === 0 && <span className="text-[10.5px] text-muted">sem agente conectado</span>}
          </div>
        </div>
      </header>

      {/* 2. trabalho atual */}
      <section className="mt-2.5">
        {p.task ? (
          <>
            <div className="flex items-baseline gap-1.5">
              <span className="min-w-0 flex-1 truncate font-medium">{p.task.title}</span>
              <span className="shrink-0 text-[10.5px] text-muted">#{p.task.number}</span>
            </div>
            {s?.activity_text && (
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="min-w-0 flex-1 truncate text-muted">{s.activity_text}</span>
                <SourceBadge source="agent_declared" />
              </div>
            )}
          </>
        ) : (
          <p className="text-muted">Sem tarefa em andamento</p>
        )}
      </section>

      {/* 3. uso e limites */}
      {(usage.length > 0 || onRefreshClaude) && (
        <section className="mt-2.5 space-y-2 border-t border-line pt-2.5">
          {usage.map((u) => (
            <AgentUsage key={u.agent} u={u} now={now} isMe={isMe} onRefresh={u.agent === "claude_code" ? onRefreshClaude : undefined} />
          ))}
          {!usage.some((u) => u.agent === "claude_code") && onRefreshClaude && (
            <AgentUsage u={null} now={now} isMe onRefresh={onRefreshClaude} />
          )}
        </section>
      )}
      {usage.length === 0 && !onRefreshClaude && (
        <p className="mt-2 text-[10.5px] text-muted">{isMe ? "Uso de IA: só no app desktop" : "Uso de IA não compartilhado"}</p>
      )}

      {/* 4. detalhes */}
      {snap && (
        <footer className="mt-2.5 flex items-center gap-1.5 border-t border-line pt-2 text-[10.5px] text-muted">
          <Icon name="branch" size={11} />
          <span className="min-w-0 flex-1 truncate" title={snap.branch ?? undefined}>
            {snap.branch ?? "HEAD destacado"}
            {snap.head_sha && <> · {shortSha(snap.head_sha)}</>}
          </span>
          {snap.dirty_files_count > 0 && (
            <span className="shrink-0">
              {snap.dirty_files_count} {snap.dirty_files_count === 1 ? "alteração" : "alterações"}
            </span>
          )}
          {snap.behind ? <span className="shrink-0 text-warn">{snap.behind} atrás</span> : null}
          <SourceBadge source="local_git" />
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

const tone = (pct: number) => (pct >= 90 ? "danger" : pct >= 70 ? "warn" : "ok");
const BAR = { ok: "bg-accent", warn: "bg-warn", danger: "bg-danger" } as const;
const TEXT = { ok: "text-text", warn: "text-warn", danger: "text-danger" } as const;

/** Um agente: nome e tokens do dia; limites de 5 h e da semana como medidores; quando foram lidos. */
function AgentUsage({ u, now, isMe, onRefresh }: { u: UsageView | null; now: Date; isMe: boolean; onRefresh?: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const at = u?.limitsObservedAt ?? null;
  const stale = !!at && now.getTime() - at.getTime() > LIMIT_STALE_MS;
  const hasLimits = !!(u?.primary || u?.secondary);

  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-medium">{AGENT_LABELS[u?.agent ?? "claude_code"]}</span>
        {u && (
          <span
            className="ml-auto text-[10.5px] text-muted"
            title={`entrada ${full.format(u.tokens.input)} · saída ${full.format(u.tokens.output)} · cache lido ${full.format(u.tokens.cache_read)} · cache gravado ${full.format(u.tokens.cache_write)}${u.models.length ? `\n${u.models.join(", ")}` : ""}`}
          >
            {compact.format(u.totalTokens)} tokens hoje
          </span>
        )}
      </div>

      {hasLimits ? (
        <div className={`mt-1.5 grid grid-cols-2 gap-3 ${stale ? "opacity-60" : ""}`}>
          {u!.primary && <Meter label="5 horas" pct={u!.primary.pct} reset={resetLabel(u!.primary.resetsAt, now)} />}
          {u!.secondary && <Meter label="Semana" pct={u!.secondary.pct} reset={resetLabel(u!.secondary.resetsAt, now)} />}
        </div>
      ) : (
        <p className="mt-0.5 text-[10.5px] text-muted">{u ? "limite não informado" : "limite ainda não lido"}</p>
      )}

      {(at || onRefresh) && (
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted">
          {at && (
            <span className={stale ? "text-warn" : ""} title={at.toLocaleString("pt-BR")}>
              {stale && "⚠ "}lido {timeAgo(at.toISOString(), now)}
            </span>
          )}
          {onRefresh && isMe && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setErr(null);
                onRefresh()
                  .catch((e) => setErr(String(e)))
                  .finally(() => setBusy(false));
              }}
              className="ml-auto rounded px-1 text-accent hover:bg-raised disabled:opacity-50"
              title="Roda o Claude Code em segundo plano (uma mensagem curta no Haiku) para ler os limites"
            >
              {busy ? "lendo…" : "↻ atualizar"}
            </button>
          )}
        </div>
      )}
      {err && <p className="mt-0.5 truncate text-[10px] text-danger" title={err}>{err}</p>}
    </div>
  );
}

/** Medidor de um limite: rótulo e percentual em cima, barra, e quando reinicia. */
function Meter({ label, pct, reset }: { label: string; pct: number; reset: string }) {
  const t = tone(pct);
  return (
    <div className="min-w-0" title={`${label}: ${pct}% do limite usado; reinicia ${reset}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-[10.5px] text-muted">{label}</span>
        <span className={`text-[13px] leading-none font-semibold tabular-nums ${TEXT[t]}`}>{Math.round(pct)}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`limite ${label}`}>
        <div className={`h-full rounded-full ${BAR[t]}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
      </div>
      <div className="mt-1 truncate text-[9.5px] leading-none text-muted">reinicia {reset}</div>
    </div>
  );
}
