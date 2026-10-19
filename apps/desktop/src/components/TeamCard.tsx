import { AGENT_LABELS, LIMIT_STALE_MS, PRESENCE_LABELS, type UsageView } from "@cooper/shared";
import { useState } from "react";
import { shortSha, timeAgo } from "../lib/format";
import type { PersonView } from "../lib/people";
import { Avatar, Icon, SourceBadge, StatusDot } from "./ui";

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
  return (
    <article className="rounded-lg border border-line bg-panel px-2.5 py-2">
      <header className="flex items-center gap-2">
        <Avatar name={p.profile.display_name} color={p.profile.avatar_color} status={p.presence} size={22} />
        <div className="min-w-0 flex-1 truncate">
          <span className="font-semibold">{p.profile.display_name}</span>
          {isMe && <span className="text-muted"> (você)</span>}
          {s && <span className="text-muted"> · {AGENT_LABELS[s.agent_kind]}</span>}
        </div>
        <span className="shrink-0 text-[10.5px] text-muted" title={p.lastSeenAt ?? undefined}>
          {timeAgo(p.lastSeenAt, now)}
        </span>
      </header>

      <div className="mt-1 space-y-0.5 pl-[30px]">
        <div className="flex items-center gap-1.5 text-[10.5px] text-muted">
          <StatusDot status={p.presence} size={6} />
          {PRESENCE_LABELS[p.presence]}
          {s?.has_hooks && p.presence !== "unknown" && <SourceBadge source="agent_hook" />}
          {!s && <span>· sem sessão de agente</span>}
          {s && !s.has_hooks && <span>· sem hooks</span>}
        </div>

        {p.task && (
          <div className="flex items-baseline gap-1">
            <span className="truncate">{p.task.title}</span>
            <span className="shrink-0 text-muted">#{p.task.number}</span>
          </div>
        )}

        {s?.activity_text && (
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-muted italic">“{s.activity_text}”</span>
            <SourceBadge source="agent_declared" />
          </div>
        )}

        {snap ? (
          <div className="flex items-center gap-1.5 text-[10.5px] text-muted">
            <Icon name="branch" size={11} />
            <span className="truncate">
              {snap.branch ?? "HEAD destacado"}
              {snap.head_sha && <> · {shortSha(snap.head_sha)}</>}
              {snap.dirty_files_count > 0 && (
                <>
                  {" "}· {snap.dirty_files_count} {snap.dirty_files_count === 1 ? "arquivo não commitado" : "arquivos não commitados"}
                </>
              )}
              {snap.behind ? <span className="text-warn"> · {snap.behind} atrás</span> : null}
            </span>
            <SourceBadge source="local_git" />
          </div>
        ) : (
          <div className="text-[10.5px] text-muted">sem dados de git local</div>
        )}

        <UsageLines usage={usage} now={now} isMe={isMe} onRefreshClaude={onRefreshClaude} />

        {p.otherSessions.map(({ session, presence }) => (
          <div key={session.id} className="flex items-center gap-1.5 text-[10.5px] text-muted">
            <StatusDot status={presence} size={6} />
            também em {AGENT_LABELS[session.agent_kind]}
            {session.activity_text && <span className="truncate">· {session.activity_text}</span>}
          </div>
        ))}
      </div>
    </article>
  );
}

const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("pt-BR");

function resetLabel(at: Date, now: Date): string {
  const sameDay = at.toDateString() === now.toDateString();
  const time = at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? time : `${at.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")} ${time}`;
}

/** Uso de IA do dia: tokens e, quando o agente informa (hoje só o Codex), os limites. Sem dado, diz isso. */
function UsageLines({ usage, now, isMe, onRefreshClaude }: { usage: UsageView[]; now: Date; isMe: boolean; onRefreshClaude?: () => Promise<void> }) {
  const hasClaude = usage.some((u) => u.agent === "claude_code");
  if (usage.length === 0 && !onRefreshClaude) return <div className="text-[10.5px] text-muted">sem dados de uso</div>;
  return (
    <>
      {usage.length === 0 && <div className="text-[10.5px] text-muted">sem dados de uso</div>}
      {usage.map((u) => (
        <div key={u.agent} className="space-y-0.5 text-[10.5px] text-muted">
          <div
            className="truncate"
            title={`entrada ${full.format(u.tokens.input)} · saída ${full.format(u.tokens.output)} · cache lido ${full.format(u.tokens.cache_read)} · cache gravado ${full.format(u.tokens.cache_write)}${u.models.length ? `
${u.models.join(", ")}` : ""}`}
          >
            {AGENT_LABELS[u.agent]} · {compact.format(u.totalTokens)} tokens hoje
            {!isMe && <span> · compartilhado</span>}
          </div>
          {u.primary && <LimitBar label="5 h" pct={u.primary.pct} reset={resetLabel(u.primary.resetsAt, now)} stale={isStale(u, now)} />}
          {u.secondary && <LimitBar label="semana" pct={u.secondary.pct} reset={resetLabel(u.secondary.resetsAt, now)} stale={isStale(u, now)} />}
          <ReadAt u={u} now={now} onRefresh={u.agent === "claude_code" ? onRefreshClaude : undefined} />
        </div>
      ))}
      {!hasClaude && onRefreshClaude && <ReadAt u={null} now={now} onRefresh={onRefreshClaude} />}
    </>
  );
}

const isStale = (u: UsageView, now: Date) => !!u.limitsObservedAt && now.getTime() - u.limitsObservedAt.getTime() > LIMIT_STALE_MS;
const hhmm = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** "limite lido 23:51" e, no meu cartão do Claude Code, o botão para ler de novo. */
function ReadAt({ u, now, onRefresh }: { u: UsageView | null; now: Date; onRefresh?: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const at = u?.limitsObservedAt ?? null;
  if (!at && !onRefresh) return null;
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-muted">
      {at ? (
        <span className={isStale(u!, now) ? "text-warn" : ""} title={at.toLocaleString("pt-BR")}>
          limite lido {hhmm(at)}
        </span>
      ) : (
        <span>Claude Code: limite não lido</span>
      )}
      {onRefresh && (
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
          className="text-accent hover:underline disabled:opacity-50"
          title="Roda o Claude Code em segundo plano (uma mensagem curta no Haiku) para ler os limites"
        >
          {busy ? "lendo…" : "atualizar limite"}
        </button>
      )}
      {err && <span className="truncate text-red-400" title={err}>{err}</span>}
    </div>
  );
}

function LimitBar({ label, pct, reset, stale }: { label: string; pct: number; reset: string; stale?: boolean }) {
  const color = stale ? "bg-idle" : pct >= 90 ? "bg-red-400" : pct >= 70 ? "bg-warn" : "bg-accent";
  return (
    <div className="flex items-center gap-1.5" title={`${label}: ${pct}% do limite usado; reinicia ${reset}`}>
      <span className="w-10 shrink-0">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`limite ${label}`}>
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      <span className="w-[74px] shrink-0 text-right">{Math.round(pct)}% · {reset}</span>
    </div>
  );
}
