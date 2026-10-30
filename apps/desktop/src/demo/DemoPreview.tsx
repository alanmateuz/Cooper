// Modo demonstração (só em desenvolvimento: http://localhost:1420/?demo).
// Pessoas e números fictícios para ver a aba Agora e a pílula com um time maior, sem tocar no Supabase.
import type { AgentKind, AgentSession, Task, UsageView } from "@cooper/shared";
import { useEffect, useMemo, useState } from "react";
import { AgentHooks } from "../components/AgentHooks";
import { NewSkill } from "../components/context/NewBlock";
import { SettingsSection } from "../components/OtherTabs";
import { RepositorySection } from "../components/RepositorySection";
import { setRepoPath, type Repository } from "../lib/repo";
import { Pill } from "../components/Pill";
import { ActivityTab } from "../components/ActivityTab";
import { ContextTab } from "../components/ContextTab";
import type { WorkspaceData } from "../lib/useWorkspace";
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

  // ?demo&shot=pessoas|equipe|ajustes|pilula: só uma peça, sem moldura, para os prints do README
  const shot = new URLSearchParams(location.search).get("shot");
  if (shot) {
    const frame = (w: number, h: number, view: "equipe" | "pessoas") => (
      <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-bg" style={{ width: w, height: h }}>
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          <LogoMark height={14} />
          <span className="font-semibold">Hacko</span>
          <span className="ml-auto text-[10.5px] text-muted">{shown.length} pessoas</span>
        </header>
        <div className="min-h-0 flex-1">
          <TeamBoard people={shown} me={me} now={now} usageOf={(id) => usage[id] ?? []} initialView={view} />
        </div>
      </div>
    );
    return (
      <div className="inline-block bg-[#2a2d35] p-4 light:bg-[#c9ccd3]" id="shot">
        {shot === "pessoas" && frame(980, 420, "pessoas")}
        {shot === "equipe" && frame(420, 400, "equipe")}
        {shot === "ajustes" && <DemoSettings filled />}
        {shot === "pilula" && (
          <div style={{ width: 340, height: 44 }}>
            <Pill people={shown} me={me} usageOf={(id) => usage[id] ?? []} alerts={0} awaiting={2} onExpand={() => {}} />
          </div>
        )}
      </div>
    );
  }

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

      <DemoSettings />

      <DemoContentTabs now={now} />

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

/** Ajustes → Repositório e Agentes → Status em tempo real, com pasta, git e hooks simulados. */
function DemoSettings({ filled }: { filled?: boolean }) {
  const [owner, setOwner] = useState(true);
  // filled: já com repositório, cópia e revisão humana (para o print)
  const [repo, setRepo] = useState<Repository | null>(() => {
    if (!filled) return null;
    setRepoPath("demo-dono", "C:/Users/voce/code/hacko");
    return { id: "r", workspace_id: "w", owner: "alanmateuz", name: "hacko", default_branch: "main" };
  });
  const [review, setReview] = useState(!!filled);
  const ws = owner ? "demo-dono" : "demo-membro";
  const btn = "rounded-md border border-line bg-panel px-2 py-1 text-[11px] hover:bg-raised";
  return (
    <div className="w-[360px] shrink-0 space-y-2 rounded-xl border border-line bg-bg p-3 shadow-2xl">
      {!filled && <div className="flex items-center gap-1.5 text-[11px]">
        <b>Ajustes (demo)</b>
        <span className="ml-auto text-muted">ver como</span>
        {[true, false].map((o) => (
          <button
            key={String(o)}
            type="button"
            onClick={() => {
              setOwner(o);
              setRepoPath(o ? "demo-dono" : "demo-membro", null);
              if (!o && !repo) setRepo({ id: "r", workspace_id: "w", owner: "alanmateuz", name: "hacko", default_branch: "main" });
            }}
            className={`${btn} ${owner === o ? "border-accent text-accent" : ""}`}
          >
            {o ? "dono" : "membro"}
          </button>
        ))}
        <button type="button" onClick={() => (setRepo(null), setRepoPath("demo-dono", null), setRepoPath("demo-membro", null), setOwner(true))} className={btn}>
          zerar
        </button>
      </div>}
      <SettingsSection title="Repositório">
        <RepositorySection
          key={`${ws}-${repo ? 1 : 0}`}
          demo
          workspaceId={ws}
          isOwner={owner}
          repo={repo}
          onRepoChange={(r) => r && setRepo({ id: "r", workspace_id: "w", owner: r.owner, name: r.name, default_branch: "main" })}
          onPathChange={() => {}}
          repoAccess={repo ? "write" : null}
          humanReview={review}
          onHumanReview={async (on) => setReview(on)}
        />
      </SettingsSection>
      <SettingsSection title="Agentes">
        <AgentHooks demo />
      </SettingsSection>
      <SettingsSection title={filled ? "Contexto → Nova skill" : "Contexto → Nova skill (só visual)"}>
        <NewSkill workspaceId="demo" onDone={() => {}} />
      </SettingsSection>
    </div>
  );
}

/** Abas Contexto e Atividade com um projeto fictício parecido com uma rodada real de duas IAs (só visual). */
function DemoContentTabs({ now }: { now: Date }) {
  const [tab, setTab] = useState<"context" | "activity">("context");
  const data = useMemo(() => demoWorkspace(now), [now]);
  const btn = "rounded-md border border-line bg-panel px-2 py-1 text-[11px] hover:bg-raised";
  return (
    <div className="flex h-[640px] w-[360px] shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-bg shadow-2xl">
      <header className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line px-3">
        <b className="mr-auto">Conteúdo (demo)</b>
        {(["context", "activity"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`${btn} ${tab === t ? "border-accent text-accent" : ""}`}>
            {t === "context" ? "Contexto" : "Atividade"}
          </button>
        ))}
      </header>
      <div className="min-h-0 flex-1">
        {tab === "context" ? <ContextTab data={data} me="u-alan" now={now} /> : <ActivityTab data={data} now={now} onOpenTask={() => {}} />}
      </div>
    </div>
  );
}

function demoWorkspace(now: Date): WorkspaceData {
  const ago = (min: number) => new Date(now.getTime() - min * MIN).toISOString();
  const member = (id: string, name: string, color: string) =>
    ({ workspace_id: "demo", user_id: id, role: "member", profile: { id, display_name: name, avatar_color: color } }) as unknown as WorkspaceData["members"][number];
  const task = (n: number, title: string, status: string, assignee: string) =>
    ({ id: `t${n}`, workspace_id: "demo", number: n, title, status, assignee_id: assignee }) as unknown as WorkspaceData["tasks"][number];
  const session = (id: string, user: string, agent: AgentKind) =>
    ({ id, workspace_id: "demo", user_id: user, agent_kind: agent, client_session_id: id, has_hooks: false, current_task_id: null,
       activity_text: null, started_at: ago(120), last_event_at: ago(1), last_event_type: "report_progress", ended_at: null }) as AgentSession;
  let n = 0;
  const ev = (min: number, user: string, sessionId: string | null, taskId: string | null, type: string, payload: Record<string, unknown>) =>
    ({ id: `e${++n}`, workspace_id: "demo", task_id: taskId, user_id: user, agent_session_id: sessionId,
       source: sessionId ? "agent_declared" : "user", type, occurred_at: ago(min), payload }) as WorkspaceData["events"][number];
  // eventos lidos do GitHub pelo app: sem pessoa nem sessão
  const github = (min: number, taskId: string, payload: Record<string, unknown>) =>
    ({ id: `e${++n}`, workspace_id: "demo", task_id: taskId, user_id: null, agent_session_id: null,
       source: "github", type: "pr_update", occurred_at: ago(min), payload }) as WorkspaceData["events"][number];
  const block = (id: string, title: string, content: string, min: number, by: string) =>
    ({ id, workspace_id: "demo", title, content, position: 0, version: 2, updated_by: by, updated_source: "agent_declared",
       updated_agent: "claude_code", updated_at: ago(min), created_at: ago(200), deleted_at: null }) as WorkspaceData["context"][number];

  const longSummary =
    "Branch integracao junta o banco do Ian (#1) e a interface (#2), com os achados da revisão (#3) aplicados: atalhos ignoram repetição e modificadores, foco vai para o enunciado. Quiz testado com o banco real e publicado como Artifact. PR #1 aberto para main, que agora é a branch padrão.";
  return {
    workspace: null,
    members: [member("u-alan", "Alan", "#6366f1"), member("u-ian", "Ian", "#14b8a6")],
    tasks: [
      task(1, "Banco de perguntas + validador", "done", "u-ian"),
      task(2, "Interface web do Quiz", "done", "u-alan"),
      task(3, "Revisão de código do front", "done", "u-ian"),
      task(4, "Integrar banco real e publicar", "in_progress", "u-alan"),
    ],
    sessions: [session("s-alan", "u-alan", "claude_code"), session("s-ian", "u-ian", "claude_code")],
    snapshots: [],
    links: [],
    usage: [],
    events: [
      github(1, "t4", { pr: 1, change: "merged", title: "Integração do quiz" }),
      ev(2, "u-alan", "s-alan", "t4", "complete_task", { summary: longSummary }),
      github(6, "t4", { pr: 1, change: "approved", title: "Integração do quiz" }),
      github(8, "t4", { pr: 1, change: "checks_success", title: "Integração do quiz" }),
      github(11, "t4", { pr: 1, change: "checks_failure", title: "Integração do quiz" }),
      github(12, "t4", { pr: 1, change: "opened", title: "Integração do quiz" }),
      ev(9, "u-alan", "s-alan", "t4", "report_progress", { text: "Artifact publicado e link no bloco Visão. PR aguardando o Alan abrir" }),
      ev(14, "u-alan", "s-alan", "t4", "report_progress", { text: "integracao: merge #1+#2, achados da #3 aplicados, validador OK" }),
      ev(16, "u-alan", "s-alan", "t4", "start_task", { branch: "integracao" }),
      ev(18, "u-alan", "s-alan", null, "context_updated", { action: "update", block_title: "Decisões", version: 5 }),
      ev(30, "u-ian", "s-ian", "t4", "dependency_done", { number: 3, title: "Revisão de código do front", all_done: true }),
      ev(30, "u-ian", "s-ian", "t3", "complete_task", { summary: "2 achados: atalhos sem filtro de repetição; foco na 1ª opção." }),
      ev(34, "u-ian", "s-ian", "t3", "report_progress", { text: "Revisando alan/interface@837e957: JSON, timer, teclado" }),
      ev(40, "u-ian", "s-ian", null, "availability_changed", { status: "near_limit", note: "cota acaba em 20 min" }),
      ev(52, "u-alan", "s-alan", "t4", "report_progress", { text: "LIBERA #3: alan/interface no GitHub @837e957" }),
      ev(55, "u-ian", "s-ian", "t1", "report_progress", { text: "LIBERA #2: sample.json e questions.json no push, ian/banco-perguntas@5673798" }),
      ev(70, "u-ian", "s-ian", "t1", "task_blocked", { reason: "push negado (403), ianeusantiago sem acesso de escrita ao repo" }),
      ev(74, "u-alan", "s-alan", "t4", "report_progress", { text: "AGUARDANDO #1 (banco real) e #3 (revisão do front)" }),
      ev(75, "u-alan", "s-alan", "t4", "report_progress", { text: "HANDOFF #4 → Ian: ver bloco Handoffs" }),
      ev(90, "u-alan", "s-alan", null, "context_updated", { action: "create", block_title: "Skill: Revisar PR", version: 1 }),
    ],
    context: [
      block("b1", "Visão do projeto: Quiz Relâmpago", "Demo de duas IAs trabalhando juntas via Cooper. Um quiz web estático: 10 perguntas sorteadas, 15 s por pergunta.", 20, "u-alan"),
      block("b2", "Contrato de dados", "Arquivo data/questions.json. Raiz: { version, questions[] }. Cada pergunta: id, category, difficulty, prompt, options (4), answerIndex, explanation.", 120, "u-alan"),
      block("b3", "Decisões", "- Projeto sem build; JS puro.\n- Branches novas a partir de main.", 18, "u-alan"),
      block("b4", "Skill: Revisar PR", "Quando usar: antes de pedir merge.\n\nPassos:\n1. Rodar os testes.\n2. Ler o diff procurando bugs.\n3. Comentar os achados no PR.\n\nPronto quando: todos os achados respondidos.", 90, "u-alan"),
      block("b5", "Skill: Publicar o quiz", "Passos:\n1. Validar o banco.\n2. Gerar a página.\n3. Publicar e registrar o link no Cooper.", 95, "u-ian"),
    ],
  } as WorkspaceData;
}
