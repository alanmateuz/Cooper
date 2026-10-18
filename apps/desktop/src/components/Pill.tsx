import { AGENT_LABELS, PRESENCE_LABELS } from "@cooper/shared";
import type { PersonView } from "../lib/people";
import { Avatar, Icon } from "./ui";

/** Modo recolhido: só avatares com status; tooltip nativo com a atividade. */
export function Pill({ people, alerts, onExpand }: { people: PersonView[]; alerts: number; onExpand: () => void }) {
  return (
    <div
      data-tauri-drag-region
      onDoubleClick={onExpand}
      className="flex h-full items-center gap-1.5 rounded-full border border-line bg-panel px-2.5"
      title="Duplo clique para abrir"
    >
      <span data-tauri-drag-region className="mr-0.5 text-[10px] font-bold tracking-wider text-accent">
        CO
      </span>
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {people.slice(0, 6).map((p) => (
          <span
            key={p.userId}
            title={[
              `${p.profile.display_name} — ${PRESENCE_LABELS[p.presence]}`,
              p.session && AGENT_LABELS[p.session.agent_kind],
              p.task && `#${p.task.number} ${p.task.title}`,
              p.session?.activity_text,
            ]
              .filter(Boolean)
              .join("\n")}
          >
            <Avatar name={p.profile.display_name} color={p.profile.avatar_color} status={p.presence} size={24} />
          </span>
        ))}
        {people.length > 6 && <span className="text-[10px] text-muted">+{people.length - 6}</span>}
      </div>
      {alerts > 0 && (
        <span className="text-warn" title={`${alerts} alerta(s) de conflito`}>
          <Icon name="alert" size={14} />
        </span>
      )}
      <button
        type="button"
        onClick={onExpand}
        aria-label="Abrir"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-text"
      >
        <Icon name="expand" size={12} />
      </button>
    </div>
  );
}
