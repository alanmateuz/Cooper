import type { UsageView } from "@cooper/shared";
import { useEffect, useState } from "react";
import type { PersonView } from "../lib/people";
import { BAR, peakLimit, TeamCard, TEXT, tone } from "./TeamCard";
import { Avatar } from "./ui";

const shortName = (n: string) => n.replace(/\s*\(.*\)/, "");

type View = "equipe" | "pessoas";
const VIEW_KEY = "cooper.agoraView";
const savedView = (): View | null => {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "equipe" || v === "pessoas" ? v : null;
  } catch {
    return null;
  }
};

/**
 * Aba Agora com duas visões, alternadas por um seletor no topo:
 * - Equipe: lista compacta (folga de IA e tarefa de cada um), para decidir para quem mandar trabalho;
 *   clicar numa pessoa abre a visão Pessoas no cartão dela.
 * - Pessoas: os cartões em grade.
 * A ordem é a mesma nas duas (estável, para não pular quando um número muda).
 */
export function TeamBoard({
  people,
  me,
  now,
  usageOf,
  onRefreshClaude,
  initialView,
}: {
  people: PersonView[];
  me: string;
  now: Date;
  usageOf: (userId: string) => UsageView[];
  onRefreshClaude?: () => Promise<void>;
  /** só para a demonstração (prints): começa nesta visão em vez da preferência salva */
  initialView?: View;
}) {
  const [view, setView] = useState<View>(() => initialView ?? savedView() ?? (people.length >= 3 ? "equipe" : "pessoas"));
  const [focus, setFocus] = useState<string | null>(null);
  const choose = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* sem armazenamento: só não lembra a escolha */
    }
  };
  // depois de trocar para Pessoas, rola até o cartão de quem foi clicado
  useEffect(() => {
    if (view !== "pessoas" || !focus) return;
    document.getElementById(`card-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setFocus(null);
  }, [view, focus]);

  const showSwitch = people.length >= 2;
  const current = showSwitch ? view : "pessoas";
  return (
    <div className="flex h-full flex-col">
      {showSwitch && (
        <div className="flex shrink-0 items-center px-2.5 pt-2">
          <div role="tablist" aria-label="Visão" className="inline-flex rounded-md border border-line bg-panel p-0.5 text-[11px]">
            {(["equipe", "pessoas"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={current === v}
                onClick={() => choose(v)}
                className={`rounded px-2.5 py-0.5 transition-colors ${current === v ? "bg-raised font-medium text-text" : "text-muted hover:text-text"}`}
              >
                {v === "equipe" ? "Equipe" : "Pessoas"}
              </button>
            ))}
          </div>
        </div>
      )}
      {current === "equipe" ? (
        <div key="equipe" className="anim-in min-h-0 flex-1 overflow-y-auto p-2.5">
          <TeamSummary
            people={people}
            me={me}
            usageOf={usageOf}
            onOpen={(id) => {
              setFocus(id);
              choose("pessoas");
            }}
          />
        </div>
      ) : (
        <div key="pessoas" className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(300px,1fr))] content-start gap-2 overflow-y-auto p-2.5">
          {people.map((p) => (
            <TeamCard
              key={p.userId}
              p={p}
              now={now}
              isMe={p.userId === me}
              usage={usageOf(p.userId)}
              onRefreshClaude={p.userId === me ? onRefreshClaude : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TeamSummary({
  people,
  me,
  usageOf,
  onOpen,
}: {
  people: PersonView[];
  me: string;
  usageOf: (userId: string) => UsageView[];
  onOpen: (userId: string) => void;
}) {
  return (
    <section className="rounded-xl border border-line bg-panel px-3 py-2" aria-label="Resumo da equipe">
      <div className="mb-1 flex items-baseline gap-2 text-[10px] text-muted">
        <span className="font-semibold tracking-wide uppercase">Equipe · {people.length}</span>
        <span className="ml-auto">barra: limite de 5 h · à direita: semana</span>
      </div>
      {/* lista que vira colunas quando a janela é larga: nome, barra e números ficam sempre juntos */}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-4">
        {people.map((p) => {
          const usage = usageOf(p.userId);
          const five = peakLimit(usage.filter((u) => u.primary));
          const week = Math.max(-1, ...usage.map((u) => u.secondary?.pct ?? -1));
          return (
            <li key={p.userId} className="border-t border-line/60 first:border-t-0">
              <button
                type="button"
                onClick={() => onOpen(p.userId)}
                className="grid w-full grid-cols-[1fr_88px_44px] items-center gap-2 rounded-md py-1.5 text-left hover:bg-raised"
                title="Ver o cartão"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar name={p.profile.display_name} color={p.profile.avatar_color} status={p.presence} size={22} />
                  <span className="min-w-0">
                    <span className="block truncate text-[11.5px] font-medium">
                      {shortName(p.profile.display_name)}
                      {p.userId === me && <span className="font-normal text-muted"> · você</span>}
                    </span>
                    <span
                      className={`block truncate text-[10.5px] ${p.task ? "font-medium" : "text-muted"}`}
                      style={p.task ? { color: `color-mix(in oklch, ${p.profile.avatar_color} 75%, var(--text))` } : undefined}
                    >
                      {p.task ? p.task.title : "sem tarefa em andamento"}
                    </span>
                  </span>
                </span>
                {five ? (
                  <span className="flex items-center gap-1.5" title={`${five.pct}% do limite de 5 h usado`}>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised" role="meter" aria-valuenow={five.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`limite de 5 h de ${shortName(p.profile.display_name)}`}>
                      <span className={`block h-full rounded-full transition-[width] duration-700 ease-out ${BAR[tone(five.pct)]}`} style={{ width: `${Math.max(3, Math.min(100, five.pct))}%` }} />
                    </span>
                    <span className={`w-8 text-right text-[11.5px] font-semibold tabular-nums ${TEXT[tone(five.pct)]}`}>{Math.round(five.pct)}%</span>
                  </span>
                ) : (
                  <span className="text-[10.5px] text-muted" title={usage.length ? "limite de 5 h não informado" : "não compartilha o uso de IA"}>
                    {usage.length ? "—" : "não compartilha"}
                  </span>
                )}
                <span className={`text-right text-[11.5px] tabular-nums ${week >= 0 ? TEXT[tone(week)] : "text-muted"}`}>{week >= 0 ? `${Math.round(week)}%` : "—"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
