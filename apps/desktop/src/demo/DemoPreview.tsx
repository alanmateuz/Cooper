// Modo demonstração (só em desenvolvimento: http://localhost:1420/?demo).
// Pessoas e números fictícios para ver a aba Agora e a pílula com um time maior, sem tocar no Supabase.
import type { AgentKind, AgentSession, Task, UsageView } from "@cooper/shared";
import { useEffect, useMemo, useState } from "react";
import { Pill } from "../components/Pill";
import { TeamBoard } from "../components/TeamBoard";
import { LogoMark } from "../components/ui";
import type { PersonView } from "../lib/people";

const MIN = 60_000;
const HOUR = 60 * MIN;

type Seed = {
  name: string;
  color: string;
  agent: AgentKind | null;
  task: [number, string] | null;
  activity: string | null;
  usage: { agent: AgentKind; five: number; week: number; readMinAgo: number; tokensM: number }[] | null;
  branch?: string;
  dirty?: number;
};

const SEEDS: Seed[] = [
  { name: "Mateus", color: "#6366f1", agent: "claude_code", task: [12, "Header da página do evento"], activity: "Ajustando o menu no mobile",
    usage: [{ agent: "claude_code", five: 38, week: 21, readMinAgo: 3, tokensM: 41 }], branch: "claude/header", dirty: 3 },
  { name: "Ian", color: "#14b8a6", agent: "codex", task: [9, "Tela de times do evento"], activity: "Escrevendo os testes da listagem",
    usage: [{ agent: "codex", five: 82, week: 47, readMinAgo: 6, tokensM: 63 }], branch: "codex/times" },
  { name: "Bia", color: "#f97316", agent: "claude_code", task: [15, "Notificações por e-mail"], activity: "Integrando o Resend",
    usage: [{ agent: "claude_code", five: 94, week: 71, readMinAgo: 2, tokensM: 88 }, { agent: "codex", five: 12, week: 9, readMinAgo: 50, tokensM: 4 }] },
  { name: "Caio", color: "#22c55e", agent: "codex", task: [7, "Validação do QR no check-in"], activity: null,
    usage: [{ agent: "codex", five: 55, week: 33, readMinAgo: 75, tokensM: 22 }] },
  { name: "Lia", color: "#e11d48", agent: null, task: null, activity: null, usage: null },
  { name: "Davi", color: "#0ea5e9", agent: "claude_code", task: [18, "Página de avaliação"], activity: "Revisando critérios com a Bia", usage: null, branch: "claude/avaliacao", dirty: 1 },
];

function build(now: Date, tick: number): { people: PersonView[]; usage: Record<string, UsageView[]> } {
  const people: PersonView[] = [];
  const usage: Record<string, UsageView[]> = {};
  SEEDS.forEach((s, i) => {
    const id = `demo-${i}`;
    const at = new Date(now.getTime() - (i + 1) * 4 * MIN).toISOString();
    // a cada "simular mudança", o Ian troca de atividade e o limite dele sobe (para ver o destaque animado)
    const activity = i === 1 && tick > 0 ? ["Corrigindo o teste que falhou", "Abrindo o PR da listagem", "Respondendo a revisão"][(tick - 1) % 3]! : s.activity;
    const session: AgentSession | null = s.agent
      ? { id: `${id}-s`, workspace_id: "demo", user_id: id, agent_kind: s.agent, client_session_id: "demo-session", has_hooks: false,
          current_task_id: s.task ? `${id}-t` : null, activity_text: activity, started_at: at, last_event_at: at, last_event_type: "report_progress", ended_at: null }
      : null;
    const task = s.task ? ({ id: `${id}-t`, number: s.task[0], title: s.task[1], status: "in_progress", assignee_id: id } as unknown as Task) : null;
    people.push({
      userId: id,
      profile: { id, display_name: s.name, avatar_color: s.color } as PersonView["profile"],
      presence: "unknown",
      session,
      sessionPresence: "unknown",
      otherSessions: [],
      task,
      snapshot: s.branch
        ? ({ id: `${id}-g`, workspace_id: "demo", user_id: id, repository_id: "r", branch: s.branch, head_sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
             ahead: 0, behind: 0, dirty_files_count: s.dirty ?? 0, observed_at: at } as PersonView["snapshot"])
        : null,
      lastSeenAt: at,
    });
    usage[id] = (s.usage ?? []).map((u) => {
      const five = i === 1 ? Math.min(100, u.five + tick * 4) : u.five;
      const tokens = { input: u.tokensM * 2e4, output: u.tokensM * 1e4, cache_read: u.tokensM * 9.7e5, cache_write: 0 };
      return {
        agent: u.agent,
        totalTokens: tokens.input + tokens.output + tokens.cache_read,
        tokens,
        models: [u.agent === "codex" ? "gpt-6.1-sol" : "claude-opus-5-5"],
        primary: { pct: five, resetsAt: new Date(now.getTime() + (1.2 + i * 0.4) * HOUR), windowMinutes: 300 },
        secondary: { pct: u.week, resetsAt: new Date(now.getTime() + (2 + i) * 24 * HOUR), windowMinutes: 10080 },
        limitsObservedAt: new Date(now.getTime() - u.readMinAgo * MIN),
      };
    });
  });
  return { people, usage };
}

const PRESETS = [
  { label: "Padrão", w: 360, h: 520 },
  { label: "Alto", w: 360, h: 900 },
  { label: "Largo", w: 980, h: 520 },
  { label: "Grande", w: 1280, h: 860 },
];

export function DemoPreview() {
  const [now, setNow] = useState(() => new Date());
  const [tick, setTick] = useState(0);
  const [count, setCount] = useState(6);
  const [size, setSize] = useState(PRESETS[0]!);
  const [theme, setTheme] = useState<"dark" | "light">(() => (document.documentElement.dataset.theme as "dark" | "light") ?? "dark");
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const { people, usage } = useMemo(() => build(now, tick), [now, tick]);
  const shown = people.slice(0, count);
  const me = shown[0]!.userId;

  const btn = "rounded-md border border-line bg-panel px-2 py-1 text-[11px] hover:bg-raised";
  return (
    <div className="flex h-full flex-col gap-4 overflow-auto bg-[#2a2d35] p-6 light:bg-[#c9ccd3] [&>*]:mx-auto">
      <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl bg-bg/90 px-3 py-2 text-[11px] shadow">
        <b>Demonstração</b>
        <span className="text-muted">pessoas</span>
        {[2, 3, 4, 6].map((n) => (
          <button key={n} type="button" onClick={() => setCount(n)} className={`${btn} ${count === n ? "border-accent text-accent" : ""}`}>{n}</button>
        ))}
        <span className="text-muted">tamanho</span>
        {PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => setSize(p)} className={`${btn} ${size.label === p.label ? "border-accent text-accent" : ""}`}>{p.label}</button>
        ))}
        <button type="button" onClick={() => setTick((t) => t + 1)} className={btn}>Simular mudança</button>
        <button type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className={btn}>{theme === "dark" ? "Tema claro" : "Tema escuro"}</button>
      </div>

      <div style={{ width: 340, height: 44 }}>
        <Pill people={shown} me={me} usageOf={(id) => usage[id] ?? []} alerts={0} awaiting={2} onExpand={() => {}} />
      </div>

      <div
        key={size.label}
        className="relative flex shrink-0 resize flex-col overflow-hidden rounded-xl border border-line bg-bg shadow-2xl"
        style={{ width: size.w, height: size.h, minWidth: 320, minHeight: 360 }}
        title="Arraste o canto para redimensionar"
      >
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          <LogoMark height={14} />
          <span className="font-semibold">Hacko (demo)</span>
          <span className="ml-auto text-[10.5px] text-muted">{shown.length} pessoas · arraste o canto ↘</span>
        </header>
        <div className="min-h-0 flex-1">
          <TeamBoard people={shown} me={me} now={now} usageOf={(id) => usage[id] ?? []} />
        </div>
      </div>
    </div>
  );
}
