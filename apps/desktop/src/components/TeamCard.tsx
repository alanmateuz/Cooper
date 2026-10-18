import { AGENT_LABELS, PRESENCE_LABELS } from "@cooper/shared";
import { shortSha, timeAgo } from "../lib/format";
import type { PersonView } from "../lib/people";
import { Avatar, Icon, SourceBadge, StatusDot } from "./ui";

export function TeamCard({ p, now, isMe }: { p: PersonView; now: Date; isMe: boolean }) {
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
