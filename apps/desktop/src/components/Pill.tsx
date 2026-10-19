import { AGENT_LABELS, PRESENCE_LABELS } from "@cooper/shared";
import type { PersonView } from "../lib/people";
import { dragFromMouseDown } from "../lib/window";
import { Avatar, Icon } from "./ui";

/**
 * Modo recolhido: avatares (selo só quando a presença é conhecida), contador de tarefas
 * aguardando o meu aceite e alertas. Tooltip nativo com o que cada pessoa está fazendo.
 */
export function Pill({ people, alerts, awaiting, onExpand }: { people: PersonView[]; alerts: number; awaiting: number; onExpand: () => void }) {
  return (
    <div
      onMouseDown={dragFromMouseDown}
      onDoubleClick={onExpand}
      className="flex h-full items-center gap-2 rounded-full border border-line bg-panel pr-1.5 pl-3"
      title="Duplo clique para abrir"
    >
      <span className="text-[10px] font-bold tracking-wider text-accent">CO</span>
      <div className="flex min-w-0 flex-1 items-center -space-x-1.5 overflow-hidden">
        {people.slice(0, 5).map((p) => (
          <span
            key={p.userId}
            className="rounded-full ring-2 ring-[var(--panel)]"
            title={[
              `${p.profile.display_name} — ${PRESENCE_LABELS[p.presence]}`,
              p.session && AGENT_LABELS[p.session.agent_kind],
              p.task && `#${p.task.number} ${p.task.title}`,
              p.session?.activity_text,
            ]
              .filter(Boolean)
              .join("\n")}
          >
            <Avatar name={p.profile.display_name} color={p.profile.avatar_color} status={p.presence} size={26} />
          </span>
        ))}
        {people.length > 5 && <span className="pl-2.5 text-[10px] text-muted">+{people.length - 5}</span>}
      </div>
      {awaiting > 0 && (
        <span className="rounded-full bg-accent px-1.5 text-[10px] leading-4 font-semibold text-white" title={`${awaiting} tarefa(s) aguardando seu aceite`}>
          {awaiting}
        </span>
      )}
      {alerts > 0 && (
        <span className="text-warn" title={`${alerts} alerta(s) de conflito`}>
          <Icon name="alert" size={14} />
        </span>
      )}
      <button
        type="button"
        onClick={onExpand}
        aria-label="Abrir"
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-text"
      >
        <Icon name="expand" size={12} />
      </button>
    </div>
  );
}
