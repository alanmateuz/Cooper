import type { Session } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import { pref, setPref } from "../lib/format";
import { buildPeople } from "../lib/people";
import { useWorkspace } from "../lib/useWorkspace";
import { dragFromMouseDown, hideWindow, inTauri, onTrayEvent, type WidgetMode } from "../lib/window";
import { ActivityTab, ContextTab, Empty, SettingsTab } from "./OtherTabs";
import { Pill } from "./Pill";
import { CreateWorkspace, MembersSection, Onboarding, PendingInvites } from "./Team";
import { TasksTab } from "./TasksTab";
import { TeamCard } from "./TeamCard";
import { Icon, IconButton } from "./ui";

type Tab = "now" | "tasks" | "context" | "activity" | "settings";
const TABS: { id: Tab; label: string; icon: Parameters<typeof Icon>[0]["name"] }[] = [
  { id: "now", label: "Agora", icon: "users" },
  { id: "tasks", label: "Tarefas", icon: "list" },
  { id: "context", label: "Contexto", icon: "book" },
  { id: "activity", label: "Atividade", icon: "activity" },
  { id: "settings", label: "Configurações", icon: "gear" },
];

export function Widget({
  session,
  mode,
  setMode,
  theme,
  setTheme,
}: {
  session: Session;
  mode: WidgetMode;
  setMode: (m: WidgetMode) => void;
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;
}) {
  const [paused, setPaused] = useState(false);
  const { data, workspaces, status, realtime, error, selectWorkspace, loadWorkspaces } = useWorkspace(paused);
  const [tab, setTab] = useState<Tab>(() => pref<Tab>("tab", "now"));
  const [dim, setDimState] = useState(() => pref("dim", false));
  const [now, setNow] = useState(() => new Date());

  // Presença depende do tempo: reavaliar a cada 15 s mesmo sem eventos novos.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let off: (() => void) | undefined;
    void onTrayEvent("sync-paused", setPaused).then((u) => (off = u));
    return () => off?.();
  }, []);

  useEffect(() => setPref("tab", tab), [tab]);
  const setDim = (v: boolean) => {
    setDimState(v);
    setPref("dim", v);
  };

  const people = useMemo(() => buildPeople(data, now), [data, now]);
  const alerts = 0; // regras de conflito: Fase 4

  if (mode === "pill") return <Pill people={people} alerts={alerts} onExpand={() => setMode("compact")} />;

  const showTab: Tab = mode === "compact" ? "now" : tab;

  return (
    <div className={`flex h-full flex-col overflow-hidden rounded-xl border border-line bg-bg shadow-2xl transition-opacity ${dim ? "opacity-60 hover:opacity-100" : ""}`}>
      <header onMouseDown={dragFromMouseDown} className="flex h-9 shrink-0 cursor-default items-center gap-1.5 border-b border-line px-2.5">
        <span className="text-[10px] font-bold tracking-wider text-accent">
          CO
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold">
          {data.workspace?.name ?? "Cooper"}
        </span>
        <span
          className={`h-1.5 w-1.5 rounded-full ${realtime === "live" ? "bg-run" : realtime === "off" ? "bg-warn" : "bg-idle"}`}
          title={realtime === "live" ? "Tempo real conectado" : paused ? "Sincronização pausada" : "Conectando…"}
        />
        <IconButton label="Recolher em pílula" onClick={() => setMode("pill")}>
          <Icon name="minimize" />
        </IconButton>
        <IconButton label={mode === "compact" ? "Expandir (abas)" : "Modo compacto"} onClick={() => setMode(mode === "compact" ? "expanded" : "compact")}>
          <Icon name={mode === "compact" ? "expand" : "collapse"} size={12} />
        </IconButton>
        {inTauri && (
          <IconButton label="Ocultar (Ctrl+Shift+Espaço)" onClick={() => void hideWindow()}>
            <Icon name="close" size={12} />
          </IconButton>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        {status === "loading" && <Empty>Carregando…</Empty>}
        {status === "error" && <Empty>Erro ao carregar: {error}</Empty>}
        {status === "empty" && <Onboarding me={session.user.id} onReady={(id) => void loadWorkspaces(id)} />}
        {status === "ready" && data.workspace && (
          <>
            {showTab === "now" && (
              <div className="h-full space-y-1.5 overflow-y-auto p-2">
                {/* alertas de conflito entram aqui (Fase 4) */}
                {people.map((p) => (
                  <TeamCard key={p.userId} p={p} now={now} isMe={p.userId === session.user.id} />
                ))}
              </div>
            )}
            {showTab === "tasks" && <TasksTab data={data} me={session.user.id} now={now} />}
            {showTab === "context" && <ContextTab data={data} />}
            {showTab === "activity" && <ActivityTab data={data} now={now} />}
            {showTab === "settings" && (
              <SettingsTab
                workspace={data.workspace}
                workspaces={workspaces}
                onSelect={(w) => void selectWorkspace(w)}
                email={session.user.email ?? ""}
                theme={theme}
                setTheme={setTheme}
                dim={dim}
                setDim={setDim}
                paused={paused}
                now={now}
              >
                <MembersSection data={data} me={session.user.id} now={now} />
                <PendingInvites onAccepted={(id) => void loadWorkspaces(id)} />
                <details>
                  <summary className="cursor-pointer text-muted hover:text-text">Novo projeto</summary>
                  <div className="pt-1.5">
                    <CreateWorkspace me={session.user.id} onCreated={(id) => void loadWorkspaces(id)} />
                  </div>
                </details>
              </SettingsTab>
            )}
          </>
        )}
      </main>

      {mode === "expanded" && (
        <nav className="flex h-9 shrink-0 items-center justify-around border-t border-line">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.label}
              aria-label={t.label}
              aria-current={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`flex h-7 w-10 items-center justify-center rounded-md ${tab === t.id ? "bg-raised text-accent" : "text-muted hover:text-text"}`}
            >
              <Icon name={t.icon} size={15} />
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

