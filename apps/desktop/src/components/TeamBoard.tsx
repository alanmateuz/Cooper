import type { UsageView } from "@cooper/shared";
import type { PersonView } from "../lib/people";
import { BAR, peakLimit, TeamCard, TEXT, tone } from "./TeamCard";
import { Avatar } from "./ui";

const shortName = (n: string) => n.replace(/\s*\(.*\)/, "");

/**
 * Aba Agora: resumo da equipe (com 3 pessoas ou mais) e os cartões em grade.
 * O resumo responde "quem tem folga de IA e em que cada um está", para decidir para quem mandar trabalho;
 * a ordem é a mesma dos cartões (estável, para não pular quando um número muda).
 */
export function TeamBoard({
  people,
  me,
  now,
  usageOf,
  onRefreshClaude,
}: {
  people: PersonView[];
  me: string;
  now: Date;
  usageOf: (userId: string) => UsageView[];
  onRefreshClaude?: () => Promise<void>;
}) {
  return (
    <div className="grid h-full auto-rows-min grid-cols-[repeat(auto-fill,minmax(300px,1fr))] content-start gap-2 overflow-y-auto p-2.5">
      {people.length >= 3 && <TeamSummary people={people} me={me} usageOf={usageOf} />}
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
  );
}

function TeamSummary({ people, me, usageOf }: { people: PersonView[]; me: string; usageOf: (userId: string) => UsageView[] }) {
  return (
    <section className="anim-in col-span-full rounded-xl border border-line bg-panel px-3 py-2" aria-label="Resumo da equipe">
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
            <li key={p.userId} className="border-t border-line/60 first:border-t-0 [&:nth-child(-n+1)]:border-t-0">
              <button
                type="button"
                onClick={() => document.getElementById(`card-${p.userId}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="grid w-full grid-cols-[1fr_88px_44px] items-center gap-2 rounded-md py-1.5 text-left hover:bg-raised"
                title="Ir para o cartão"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar name={p.profile.display_name} color={p.profile.avatar_color} status={p.presence} size={22} />
                  <span className="min-w-0">
                    <span className="block truncate text-[11.5px] font-medium">
                      {shortName(p.profile.display_name)}
                      {p.userId === me && <span className="font-normal text-muted"> · você</span>}
                    </span>
                    <span className="block truncate text-[10.5px] text-muted">
                      {p.task ? `#${p.task.number} ${p.task.title}` : "sem tarefa em andamento"}
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
