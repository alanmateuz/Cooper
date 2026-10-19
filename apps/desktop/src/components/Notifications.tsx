import { timeAgo } from "../lib/format";
import type { CooperNotification, NotificationKind } from "../lib/notifications";
import { Icon } from "./ui";

const KIND: Record<NotificationKind, { icon: Parameters<typeof Icon>[0]["name"]; tone: string }> = {
  task_received: { icon: "list", tone: "bg-accent/15 text-accent" },
  task_done: { icon: "check", tone: "bg-run/15 text-run" },
  task_accepted: { icon: "check", tone: "bg-online/15 text-online" },
  task_declined: { icon: "close", tone: "bg-warn/15 text-warn" },
  usage_critical: { icon: "gauge", tone: "bg-danger/15 text-danger" },
};

/** Sino do cabeçalho, com bolinha verde quando há notificação não lida. */
export function BellButton({ unread, open, onClick }: { unread: number; open: boolean; onClick: () => void }) {
  const label = unread > 0 ? `Notificações (${unread} nova${unread > 1 ? "s" : ""})` : "Notificações";
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-expanded={open}
      onClick={onClick}
      className={`relative inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-raised ${open ? "bg-raised text-accent" : unread ? "text-text" : "text-muted hover:text-text"}`}
    >
      <Icon name="bell" size={13} />
      {unread > 0 && <span className="absolute top-[3px] right-[3px] h-2 w-2 rounded-full bg-run ring-2 ring-bg" />}
    </button>
  );
}

/** Lista de notificações, por cima do conteúdo. As que eram novas ao abrir ficam destacadas. */
export function NotificationsPanel({
  items,
  fresh,
  now,
  onOpenTask,
  onClose,
}: {
  items: CooperNotification[];
  fresh: Set<string>;
  now: Date;
  onOpenTask: (taskId: string) => void;
  onClose: () => void;
}) {
  return (
    <aside className="absolute inset-0 z-20 flex flex-col bg-bg" role="dialog" aria-label="Notificações">
      <header className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <h2 className="flex-1 text-[10.5px] font-semibold tracking-wide text-muted uppercase">Notificações</h2>
        <button type="button" onClick={onClose} aria-label="Fechar notificações" className="text-muted hover:text-text">
          <Icon name="close" size={13} />
        </button>
      </header>
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-6 text-center text-muted">
          <Icon name="bell" size={18} />
          <p>Nada por aqui ainda.</p>
          <p className="text-[10.5px] leading-snug">Tarefas que chegam, aceites, conclusões do time e uso crítico de IA aparecem aqui.</p>
        </div>
      ) : (
        <ol className="flex-1 space-y-1 overflow-y-auto px-2 pb-2">
          {items.map((n) => {
            const k = KIND[n.kind];
            const isFresh = fresh.has(n.id);
            const body = (
              <>
                <span className={`mt-px inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${k.tone}`}>
                  <Icon name={k.icon} size={12} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${isFresh ? "font-semibold" : ""}`}>{n.text}</span>
                  {n.detail && <span className="block truncate text-[10.5px] text-muted">{n.detail}</span>}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1 pt-px">
                  <span className="text-[10px] text-muted">{timeAgo(new Date(n.at).toISOString(), now)}</span>
                  {isFresh && <span className="h-1.5 w-1.5 rounded-full bg-run" aria-label="nova" />}
                </span>
              </>
            );
            const cls = `flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left ${isFresh ? "bg-accent/[0.07]" : ""}`;
            return (
              <li key={n.id}>
                {n.taskId ? (
                  <button type="button" onClick={() => onOpenTask(n.taskId!)} className={`${cls} hover:bg-raised`}>
                    {body}
                  </button>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
