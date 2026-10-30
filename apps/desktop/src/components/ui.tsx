import { PRESENCE_LABELS, SOURCE_LABELS, type EventSource, type PresenceStatus } from "@cooper/shared";
import type { ReactNode } from "react";
import { initials } from "../lib/format";

const DOT: Record<PresenceStatus, string> = {
  running: "bg-run shadow-[0_0_0_3px_color-mix(in_srgb,var(--run)_25%,transparent)]",
  online: "bg-run",
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
        // cor da pessoa um pouco apagada: identifica sem competir com os alertas de limite
        style={{ background: `color-mix(in oklch, ${color} 72%, #6b7080)`, fontSize: Math.round(size * 0.38) }}
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
    <span className="shrink-0 rounded border border-line px-1 py-px text-[10px] leading-none whitespace-nowrap text-muted" title={`origem: ${text}`}>
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
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z",
  gauge: "M12 14l3.5-3.5M3.3 17a9 9 0 1 1 17.4 0",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z",
  terminal: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm3 5 3 2-3 2m5 0h5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

// Marca do GitHub (Simple Icons, CC0).
const GITHUB =
  "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12";

/**
 * Ícones das integrações: GitHub (marca oficial), Claude Code (estrela coral, no estilo da marca) e Codex
 * (terminal, desenho próprio). Só para reconhecer onde cada um aparece; o texto continua ao lado.
 */
export function BrandIcon({ brand, size = 14 }: { brand: "github" | "claude_code" | "codex"; size?: number }) {
  if (brand === "github")
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d={GITHUB} />
      </svg>
    );
  if (brand === "claude_code")
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#d97757" strokeWidth={2.6} strokeLinecap="round" aria-hidden>
        <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="4" />
      <path d="m7.5 10 3 2-3 2M13 14h3.5" />
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

/** Marca nas telas de entrada (login e configuração): símbolo, nome e uma frase do que o Cooper faz. */
export function BrandHeader({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center text-center ${compact ? "gap-1" : "gap-2"}`}>
      <LogoMark height={compact ? 28 : 40} />
      <div className={`${compact ? "text-[15px]" : "text-[18px]"} leading-none font-semibold tracking-tight`}>Cooper</div>
      {!compact && <p className="max-w-[240px] text-[11px] leading-snug text-muted">Tarefas, contexto e limites de IA do seu time, num só lugar.</p>}
    </div>
  );
}

/**
 * Confirmação na própria tela (no lugar do confirm() nativo): faixa com o texto e dois botões.
 * `children`: conteúdo extra (ex.: campo para digitar o nome do projeto).
 */
export function ConfirmBar({
  text,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
  disabled,
  error,
  tone = "danger",
  children,
}: {
  text: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  disabled?: boolean;
  error?: string | null;
  tone?: "danger" | "warn";
  children?: ReactNode;
}) {
  const box = tone === "danger" ? "border-danger/30 bg-danger/10" : "border-warn/30 bg-warn/10";
  const btn = tone === "danger" ? "bg-danger" : "bg-warn";
  return (
    <div className={`space-y-1.5 rounded-lg border px-2.5 py-2 ${box}`} role="alert">
      <p className="leading-snug">{text}</p>
      {children}
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onCancel} className="rounded-md px-2 py-0.5 text-muted hover:text-text">
          Cancelar
        </button>
        <button type="button" disabled={busy || disabled} onClick={onConfirm} className={`rounded-md px-2 py-0.5 font-medium text-white disabled:opacity-40 ${btn}`}>
          {busy ? "Aguarde…" : confirmLabel}
        </button>
      </div>
      {error && <p className="text-[10.5px] text-danger">{error}</p>}
    </div>
  );
}
