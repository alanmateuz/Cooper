import { AGENT_LABELS, PRESENCE_LABELS, type UsageView } from "@cooper/shared";
import type { PersonView } from "../lib/people";
import { dragFromMouseDown } from "../lib/window";
import { Avatar, Icon, LogoMark } from "./ui";

/** Maior uso de 5 h entre os agentes da pessoa (é o que acaba primeiro). */
function fiveHour(usage: UsageView[]): number | null {
  const pcts = usage.map((u) => u.primary?.pct).filter((p): p is number => p != null);
  return pcts.length ? Math.max(...pcts) : null;
}

const tone = (pct: number) => (pct >= 90 ? "text-danger" : pct >= 70 ? "text-warn" : "text-text");
const bar = (pct: number) => (pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warn" : "bg-accent");

/**
 * Modo recolhido. Mostra quem está com você (a outra pessoa do time, ou a mais ativa se houver várias):
 * tarefa atual, última atividade declarada e o limite de 5 h, se ela compartilha o uso.
 * Os demais membros viram avatares pequenos; o tooltip traz o resto.
 */
export function Pill({
  people,
  me,
  usageOf,
  alerts,
  awaiting,
  onExpand,
}: {
  people: PersonView[];
  me: string;
  usageOf: (userId: string) => UsageView[];
  alerts: number;
  awaiting: number;
  onExpand: () => void;
}) {
  const others = people.filter((p) => p.userId !== me);
  const focus = others[0] ?? null; // people já vem ordenado por presença
  const rest = others.slice(1, 4);
  const pct = focus ? fiveHour(usageOf(focus.userId)) : null;
  const name = focus?.profile.display_name.replace(/\s*\(.*\)/, "") ?? "";
  const line1 = focus?.task ? focus.task.title : "Sem tarefa em andamento";
  const line2 = focus?.session?.activity_text ?? (focus?.session ? AGENT_LABELS[focus.session.agent_kind] : "sem agente conectado");

  return (
    <div
      onMouseDown={dragFromMouseDown}
      onDoubleClick={onExpand}
      className="flex h-full items-center gap-2 rounded-full border border-line bg-panel pr-1.5 pl-1.5"
      title="Duplo clique para abrir"
    >
      {focus ? (
        <>
          <span
            className="shrink-0"
            title={[`${focus.profile.display_name} — ${PRESENCE_LABELS[focus.presence]}`, focus.task && `#${focus.task.number} ${focus.task.title}`, focus.session?.activity_text]
              .filter(Boolean)
              .join("\n")}
          >
            <Avatar name={focus.profile.display_name} color={focus.profile.avatar_color} status={focus.presence} size={30} />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex items-baseline gap-1">
              <span className="shrink-0 text-[11px] font-semibold">{name}</span>
              {focus.task && <span className="shrink-0 text-[10px] text-muted">#{focus.task.number}</span>}
              <span className="min-w-0 truncate text-[11px]">{line1}</span>
            </div>
            <div className="truncate text-[10px] text-muted">{line2}</div>
          </div>
          {pct != null && (
            <div className="w-10 shrink-0 text-right" title={`${name}: ${pct}% do limite de 5 h usado`}>
              <div className={`text-[12px] leading-none font-semibold tabular-nums ${tone(pct)}`}>{Math.round(pct)}%</div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-raised">
                <div className={`h-full rounded-full ${bar(pct)}`} style={{ width: `${Math.max(4, Math.min(100, pct))}%` }} />
              </div>
              <div className="mt-0.5 text-[8.5px] leading-none text-muted">5 h</div>
            </div>
          )}
          {rest.length > 0 && (
            <div className="flex shrink-0 -space-x-1.5">
              {rest.map((p) => (
                <span key={p.userId} className="rounded-full ring-2 ring-[var(--panel)]" title={`${p.profile.display_name}${p.task ? ` — #${p.task.number} ${p.task.title}` : ""}`}>
                  <Avatar name={p.profile.display_name} color={p.profile.avatar_color} size={20} />
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <span className="flex-1 pl-1.5 text-[11px] text-muted">
          <span className="mr-1.5 inline-flex align-middle"><LogoMark height={11} bg="var(--panel)" /></span>Só você neste workspace
        </span>
      )}
      {awaiting > 0 && (
        <span className="shrink-0 rounded-full bg-accent px-1.5 text-[10px] leading-4 font-semibold text-white" title={`${awaiting} tarefa(s) aguardando seu aceite`}>
          {awaiting}
        </span>
      )}
      {alerts > 0 && (
        <span className="shrink-0 text-warn" title={`${alerts} alerta(s) de conflito`}>
          <Icon name="alert" size={14} />
        </span>
      )}
      <button
        type="button"
        onClick={onExpand}
        aria-label="Abrir"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-text"
      >
        <Icon name="expand" size={12} />
      </button>
    </div>
  );
}
