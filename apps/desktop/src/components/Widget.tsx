import { localDay, viewsFromReport, viewsFromRows } from "@cooper/shared";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import { pref, setPref } from "../lib/format";
import { buildNotifications, useNotificationState } from "../lib/notifications";
import { buildPeople } from "../lib/people";
import { playChime } from "../lib/sound";
import { claudeAutoRefreshPref, CLAUDE_AUTO_REFRESH_PREF, refreshClaudeLimits, useClaudeAutoRefresh, useLocalUsage, useShareUsage } from "../lib/usage";
import { useWorkspace } from "../lib/useWorkspace";
import { dragFromMouseDown, hideWindow, inTauri, onTrayEvent, type WidgetMode } from "../lib/window";
import { ContextTab } from "./ContextTab";
import { BellButton, NotificationsPanel } from "./Notifications";
import { ActivityTab } from "./ActivityTab";
import { Empty, NotificationSettings, PrivacySection, SettingsSection, SettingsTab } from "./OtherTabs";
import { Pill } from "./Pill";
import { ClaudeStatusLine } from "./ClaudeStatusLine";
import { CreateWorkspace, MembersSection, Onboarding, PendingInvites } from "./Team";
import { awaitingForMe, TasksTab } from "./TasksTab";
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
  const { data, workspaces, status, realtime, error, selectWorkspace, loadWorkspaces, reload } = useWorkspace(paused);
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
  const me = session.user.id;
  const sharing = data.members.find((m) => m.user_id === me)?.share_usage ?? false;
  const { report: localUsage, reload: reloadUsage } = useLocalUsage();
  const shareStatus = useShareUsage(localUsage, data.workspace?.id ?? null, me, sharing);
  const [autoRefresh, setAutoRefreshState] = useState(claudeAutoRefreshPref);
  const setAutoRefresh = (v: boolean) => {
    setAutoRefreshState(v);
    setPref(CLAUDE_AUTO_REFRESH_PREF, v);
  };
  useClaudeAutoRefresh(autoRefresh, localUsage, reloadUsage);
  const refreshClaude = inTauri
    ? async () => {
        await refreshClaudeLimits();
        await reloadUsage();
      }
    : undefined;
  const today = localDay(now).day;
  const usageOf = (userId: string) =>
    userId === me ? viewsFromReport(localUsage) : viewsFromRows(data.usage.filter((u) => u.user_id === userId), today, now);
  const awaiting = useMemo(() => awaitingForMe(data, session.user.id), [data, session.user.id]);

  // Notificações: sino no cabeçalho, som ao chegar algo novo e aviso de uso crítico do time.
  const [soundOn, setSoundOnState] = useState(() => pref("notifSound", true));
  const [usageAlerts, setUsageAlertsState] = useState(() => pref("notifUsage", true));
  const setSoundOn = (v: boolean) => {
    setSoundOnState(v);
    setPref("notifSound", v);
  };
  const setUsageAlerts = (v: boolean) => {
    setUsageAlertsState(v);
    setPref("notifUsage", v);
  };
  const notifications = useMemo(() => buildNotifications(data, me, today, now, usageAlerts), [data, me, today, now, usageAlerts]);
  const notif = useNotificationState(notifications, status === "ready", soundOn);
  const [notifOpen, setNotifOpen] = useState<Set<string> | null>(null);
  const toggleNotifications = () => {
    if (notifOpen) return setNotifOpen(null);
    setNotifOpen(new Set(notifications.filter(notif.isUnread).map((n) => n.id)));
    notif.markSeen();
  };
  const [focusTask, setFocusTask] = useState<{ id: string; nonce: number } | null>(null);
  const openTask = (id: string) => {
    setNotifOpen(null);
    setFocusTask({ id, nonce: Date.now() });
    setTab("tasks");
    setMode("expanded");
  };

  if (mode === "pill")
    return <Pill people={people} me={me} usageOf={usageOf} alerts={alerts} awaiting={awaiting.length} onExpand={() => setMode("compact")} />;

  const showTab: Tab = mode === "compact" ? "now" : tab;

  return (
    <div className={`flex h-full flex-col overflow-hidden rounded-xl border border-line bg-bg shadow-2xl transition-opacity ${dim ? "opacity-60 hover:opacity-100" : ""}`}>
      <header onMouseDown={dragFromMouseDown} className="flex h-9 shrink-0 cursor-default items-center gap-1.5 border-b border-line px-2.5">
        <span className="text-[10px] font-bold tracking-wider text-accent">
          CO
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate font-semibold">{data.workspace?.name ?? "Cooper"}</span>
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${realtime === "live" ? "bg-run" : realtime === "off" ? "bg-warn" : "bg-idle"}`}
            title={realtime === "live" ? "Tempo real conectado" : paused ? "Sincronização pausada" : "Conectando…"}
          />
        </span>
        <BellButton unread={notif.unread} open={!!notifOpen} onClick={toggleNotifications} />
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

      <main className="relative min-h-0 flex-1 overflow-hidden">
        {status === "loading" && <Empty>Carregando…</Empty>}
        {status === "error" && <Empty>Erro ao carregar: {error}</Empty>}
        {status === "empty" && <Onboarding me={session.user.id} onReady={(id) => void loadWorkspaces(id)} />}
        {status === "ready" && data.workspace && (
          <>
            {showTab === "now" && (
              <div className="h-full space-y-2 overflow-y-auto p-2.5">
                {/* alertas de conflito entram aqui (Fase 4); tarefas novas e avisos ficam no sino */}
                {people.map((p) => (
                  <TeamCard key={p.userId} p={p} now={now} isMe={p.userId === me} usage={usageOf(p.userId)} onRefreshClaude={p.userId === me ? refreshClaude : undefined} />
                ))}
              </div>
            )}
            {showTab === "tasks" && (
              <TasksTab key={focusTask?.nonce ?? 0} data={data} me={session.user.id} now={now} initialOpenId={focusTask?.id ?? null} />
            )}
            {showTab === "context" && <ContextTab data={data} me={me} now={now} />}
            {showTab === "activity" && <ActivityTab data={data} now={now} onOpenTask={openTask} />}
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
                projects={
                  <SettingsSection title="Novo projeto">
                    <CreateWorkspace me={session.user.id} onCreated={(id) => void loadWorkspaces(id)} />
                  </SettingsSection>
                }
              >
                <SettingsSection title="Notificações">
                  <NotificationSettings
                    sound={soundOn}
                    setSound={setSoundOn}
                    usageAlerts={usageAlerts}
                    setUsageAlerts={setUsageAlerts}
                    onTest={() => playChime("normal")}
                    onTestCritical={() => playChime("critical")}
                  />
                </SettingsSection>
                <SettingsSection title="Equipe">
                  <MembersSection data={data} me={session.user.id} now={now} onProfileChange={() => void reload("workspace_members", data.workspace!.id)} />
                  <PendingInvites onAccepted={(id) => void loadWorkspaces(id)} />
                </SettingsSection>
                <SettingsSection title="Uso de IA">
                  <PrivacySection workspaceId={data.workspace.id} sharing={sharing} status={shareStatus} />
                  <ClaudeStatusLine autoRefresh={autoRefresh} setAutoRefresh={setAutoRefresh} />
                </SettingsSection>
              </SettingsTab>
            )}
          </>
        )}
        {notifOpen && status === "ready" && (
          <NotificationsPanel
            items={notifications}
            fresh={notifOpen}
            now={now}
            onClose={() => setNotifOpen(null)}
            onOpenTask={openTask}
          />
        )}
      </main>

      {mode === "expanded" && (
        <nav className="flex h-11 shrink-0 items-stretch justify-around border-t border-line px-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.label}
              aria-label={t.label}
              aria-current={tab === t.id}
              onClick={() => {
                setTab(t.id);
                setFocusTask(null);
              }}
              className={`relative my-1 flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md ${tab === t.id ? "bg-raised text-accent" : "text-muted hover:text-text"}`}
            >
              <Icon name={t.icon} size={14} />
              <span className="text-[9.5px] leading-none">{t.label === "Configurações" ? "Ajustes" : t.label}</span>
              {t.id === "tasks" && awaiting.length > 0 && (
                <span className="absolute top-0.5 right-[calc(50%-17px)] min-w-3.5 rounded-full bg-accent px-0.5 text-center text-[9px] leading-3.5 font-semibold text-white" aria-label={`${awaiting.length} aguardando aceite`}>
                  {awaiting.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

