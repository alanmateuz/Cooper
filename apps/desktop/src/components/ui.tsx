import { PRESENCE_LABELS, SOURCE_LABELS, type EventSource, type PresenceStatus } from "@cooper/shared";
import type { ReactNode } from "react";
import { initials } from "../lib/format";

const DOT: Record<PresenceStatus, string> = {
  running: "bg-run shadow-[0_0_0_3px_color-mix(in_srgb,var(--run)_25%,transparent)]",
  online: "bg-online",
  // sólido: translúcido, sobre o anel escuro do tema escuro, parecia uma mancha preta
  idle: "bg-idle",
  unknown: "border border-dashed border-idle bg-transparent",
};

export function StatusDot({ status, size = 8 }: { status: PresenceStatus; size?: number }) {
  return (
    <span
      title={PRESENCE_LABELS[status]}
      aria-label={PRESENCE_LABELS[status]}
      className={`inline-block shrink-0 rounded-full ${DOT[status]}`}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Avatar com selo de presença. "Desconhecido" (nenhuma chamada ao Cooper) não ganha selo:
 * um círculo vazio não informa nada e parecia uma mancha no avatar.
 * Sem anel em volta do selo: o anel na cor do fundo "mordia" a borda do avatar.
 */
export function Avatar({ name, color, status, size = 24 }: { name: string; color: string; status?: PresenceStatus; size?: number }) {
  const dot = Math.max(7, Math.round(size * 0.28));
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        className="inline-flex h-full w-full items-center justify-center rounded-full font-semibold text-white"
        style={{ background: color, fontSize: Math.round(size * 0.38) }}
      >
        {initials(name)}
      </span>
      {status && status !== "unknown" && (
        <span
          className="absolute -right-px -bottom-px rounded-full"
          title={PRESENCE_LABELS[status]}
          style={{ width: dot, height: dot }}
        >
          <StatusDot status={status} size={dot} />
        </span>
      )}
    </span>
  );
}

export function SourceBadge({ source, label }: { source: EventSource | "ai_summary"; label?: string }) {
  const text = label ?? (source === "ai_summary" ? "resumo IA" : SOURCE_LABELS[source]);
  return (
    <span className="shrink-0 rounded border border-line px-1 py-px text-[9.5px] leading-none whitespace-nowrap text-muted" title={`origem: ${text}`}>
      {text}
    </span>
  );
}

export function IconButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-raised ${active ? "text-accent" : "text-muted hover:text-text"}`}
    >
      {children}
    </button>
  );
}

const PATHS = {
  users: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm13 9v-1a4 4 0 0 0-3-3.87M16 4.13a3 3 0 0 1 0 5.74",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14ZM20 17v4H6.5A2.5 2.5 0 0 1 4 18.5",
  activity: "M22 12h-4l-3 8L9 4l-3 8H2",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
  minimize: "M5 12h14",
  expand: "M4 14v6h6M20 10V4h-6M4 20l7-7M20 4l-7 7",
  collapse: "M10 4v6H4M14 20v-6h6M4 10l6-6M20 14l-6 6",
  close: "M18 6 6 18M6 6l12 12",
  alert: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  branch: "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm12-12a9 9 0 0 1-9 9",
  chevron: "m9 18 6-6-6-6",
  plus: "M12 5v14M5 12h14",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0",
  trash: "M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 5v6m4-6v6",
  check: "M20 6 9 17l-5-5",
  play: "M7 4.5v15l12-7.5-12-7.5Z",
  gauge: "M12 14l3.5-3.5M3.3 17a9 9 0 1 1 17.4 0",
} as const;

export function Icon({ name, size = 14 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

const LOGO_LIGHT = "M500 239 L511.5 239 A102.5 102.5 0 0 1 511.5 444 L470 444 A102.5 102.5 0 0 1 367.5 341.5 L367.5 322";
const LOGO_LIGHT_FRONT = "M470 444 A102.5 102.5 0 0 1 367.5 341.5 L367.5 322";
const LOGO_DARK = "M446 232 Q432 194 398 194 L314 194 A125.5 125.5 0 0 0 314 445 L348 445";

/**
 * Símbolo da logo (os dois "C" entrelaçados). As cores vêm do tema (--logo-a, --logo-b);
 * `bg` é a cor do fundo onde ele aparece, usada para o vão entre os dois C.
 */
export function LogoMark({ height = 14, bg = "var(--bg)" }: { height?: number; bg?: string }) {
  return (
    <svg height={height} width={Math.round((height * 530) / 355)} viewBox="135 140 530 355" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-label="Cooper" role="img">
      <path d={LOGO_LIGHT} stroke="var(--logo-b)" strokeWidth={88} />
      <path d={LOGO_DARK} stroke={bg} strokeWidth={117} />
      <path d={LOGO_DARK} stroke="var(--logo-a)" strokeWidth={97} />
      <path d={LOGO_LIGHT_FRONT} stroke={bg} strokeWidth={108} strokeLinecap="butt" />
      <path d={LOGO_LIGHT_FRONT} stroke="var(--logo-b)" strokeWidth={88} />
    </svg>
  );
}
