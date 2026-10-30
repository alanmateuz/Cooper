import { localDay, viewsFromReport, viewsFromRows, type AgentKind } from "@cooper/shared";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import { pref, setPref } from "../lib/format";
import { buildNotifications, useNotificationState } from "../lib/notifications";
import { buildPeople } from "../lib/people";
import { playChime } from "../lib/sound";
import { claudeAutoRefreshPref, CLAUDE_AUTO_REFRESH_PREF, refreshClaudeLimits, useClaudeAutoRefresh, useLocalUsage, useShareUsage } from "../lib/usage";
import { supabase } from "../lib/supabase";
import { useWorkspace } from "../lib/useWorkspace";
import { dragFromMouseDown, hideWindow, inTauri, onTrayEvent, resizeFromMouseDown, type WidgetMode } from "../lib/window";
import { ContextTab } from "./ContextTab";
import { BellButton, NotificationsPanel } from "./Notifications";
import { ActivityTab } from "./ActivityTab";
import { RepositorySection } from "./RepositorySection";
import { useGitSync, useTeamRepo } from "../lib/repo";
import { useGithubSync } from "../lib/github";
import { AgentVisibility, CoordinationSection, Empty, UiSoundsRow, NotificationSettings, PrivacySection, SettingsSection, SettingsTab } from "./OtherTabs";
import { Pill } from "./Pill";
import { ClaudeStatusLine } from "./ClaudeStatusLine";
import { CreateWorkspace, MembersSection, Onboarding, PendingInvites, ProjectSection } from "./Team";
import { awaitingForMe, TasksTab } from "./TasksTab";
import { TeamBoard } from "./TeamBoard";
import { Icon, IconButton, LogoMark } from "./ui";

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
  const { data, workspaces, status, realtime, error, syncError, selectWorkspace, loadWorkspaces, reload } = useWorkspace(paused);
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
  const myMember = data.members.find((m) => m.user_id === me);
  // repositório do time e envio do estado do git local (a cada minuto, só no app desktop)
  const { repo, reload: reloadRepo } = useTeamRepo(data.workspace?.id ?? null);
  const [repoVersion, setRepoVersion] = useState(0);
  useGitSync(data.workspace?.id ?? null, repo, repoVersion);
  // PRs, CI e acesso ao repositório (GitHub), entregues ao servidor; repoVersion muda também ao trocar o token
  useGithubSync(data.workspace?.id ?? null, repo, repoVersion);
  // política local dos hooks: com "Só pessoas aprovam PRs", o hook barra aprovação e merge de PR pelo agente
  const humanReview = data.workspace?.require_human_review;
  useEffect(() => {
    if (!inTauri || humanReview === undefined) return;
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke("set_hook_policy", { blockPrApproval: humanReview })).catch(() => {});
  }, [humanReview]);
  const sharing = myMember?.share_usage ?? false;
  const { report: rawUsage, reload: reloadUsage } = useLocalUsage();
  // Agentes que a pessoa tirou do cartão (⚙ → Uso de IA): o uso deles não é lido para mostrar nem enviado.
  const [hiddenAgents, setHiddenAgentsState] = useState<AgentKind[]>(() => pref<AgentKind[]>("hiddenAgents", []));
  const localUsage = useMemo(
    () => (rawUsage ? { claude_code: hiddenAgents.includes("claude_code") ? null : rawUsage.claude_code, codex: hiddenAgents.includes("codex") ? null : rawUsage.codex } : null),
    [rawUsage, hiddenAgents],
  );
  const setAgentHidden = (agent: AgentKind, hide: boolean) => {
    const next = hide ? [...new Set([...hiddenAgents, agent])] : hiddenAgents.filter((a) => a !== agent);
    setHiddenAgentsState(next);
    setPref("hiddenAgents", next);
    // o que já tinha sido compartilhado desse agente some para o time
    if (hide && data.workspace) void supabase.from("ai_usage").delete().eq("workspace_id", data.workspace.id).eq("user_id", me).eq("agent_kind", agent);
  };
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
    <div className={`relative flex h-full flex-col overflow-hidden rounded-xl border border-line bg-bg shadow-2xl transition-opacity ${dim ? "opacity-60 hover:opacity-100" : ""}`}>
      <header onMouseDown={dragFromMouseDown} className="flex h-9 shrink-0 cursor-default items-center gap-1.5 border-b border-line px-2.5">
        <LogoMark height={13} />
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

      {syncError && status === "ready" && (
        <p className="shrink-0 border-b border-danger/30 bg-danger/10 px-2.5 py-1 text-[10.5px] leading-snug text-danger" role="status">
          Não consegui atualizar: {syncError}
        </p>
      )}
      <main className="relative min-h-0 flex-1 overflow-hidden">
        {status === "loading" && <Empty>Carregando…</Empty>}
        {status === "error" && <Empty>Erro ao carregar: {error}</Empty>}
        {status === "empty" && <Onboarding me={session.user.id} onReady={(id) => void loadWorkspaces(id)} />}
        {status === "ready" && data.workspace && (
          <div key={showTab} className="anim-in h-full">
            {showTab === "now" && <TeamBoard people={people} me={me} now={now} usageOf={usageOf} onRefreshClaude={refreshClaude} />}
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
                  <UiSoundsRow />
                </SettingsSection>
                <SettingsSection title="Equipe">
                  <MembersSection data={data} me={session.user.id} now={now} onProfileChange={() => void reload("workspace_members", data.workspace!.id)} />
                  <PendingInvites onAccepted={(id) => void loadWorkspaces(id)} />
                </SettingsSection>
                <SettingsSection title="Projeto">
                  <ProjectSection data={data} me={session.user.id} onChanged={(keepId) => void loadWorkspaces(keepId)} />
                </SettingsSection>
                <SettingsSection title="Repositório">
                  <RepositorySection
                    key={data.workspace.id}
                    workspaceId={data.workspace.id}
                    isOwner={myMember?.role === "owner"}
                    repo={repo}
                    onRepoChange={() => void reloadRepo()}
                    onPathChange={() => setRepoVersion((v) => v + 1)}
                    repoAccess={myMember?.repo_access}
                    humanReview={data.workspace.require_human_review}
                    onHumanReview={async (on) => {
                      const { error } = await supabase.from("workspaces").update({ require_human_review: on }).eq("id", data.workspace!.id);
                      if (error) throw error;
                      await loadWorkspaces(data.workspace!.id);
                    }}
                  />
                </SettingsSection>
                <SettingsSection title="IA e tarefas">
                  <CoordinationSection workspaceId={data.workspace.id} coordinator={myMember?.ai_coordinator ?? false} autoAccept={myMember?.auto_accept ?? false} />
                </SettingsSection>
                <SettingsSection title="Uso de IA">
                  <PrivacySection workspaceId={data.workspace.id} sharing={sharing} status={shareStatus} />
                  <AgentVisibility hidden={hiddenAgents} onChange={setAgentHidden} />
                  <ClaudeStatusLine autoRefresh={autoRefresh} setAutoRefresh={setAutoRefresh} />
                </SettingsSection>
              </SettingsTab>
            )}
          </div>
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
              <span className="text-[10px] leading-none">{t.label === "Configurações" ? "Ajustes" : t.label}</span>
              {t.id === "tasks" && awaiting.length > 0 && (
                <span key={awaiting.length} className="anim-pop absolute top-0.5 right-[calc(50%-17px)] min-w-3.5 rounded-full bg-accent px-0.5 text-center text-[10px] leading-3.5 font-semibold text-white" aria-label={`${awaiting.length} aguardando aceite`}>
                  {awaiting.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      )}
      {inTauri && (
        <div
          onMouseDown={resizeFromMouseDown}
          title="Arraste para redimensionar"
          aria-hidden
          className="absolute right-0 bottom-0 h-4 w-4 cursor-se-resize text-muted/60 hover:text-muted"
        >
          <svg viewBox="0 0 16 16" className="h-full w-full" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
            <path d="M14 8 8 14M14 11.5 11.5 14" />
          </svg>
        </div>
      )}
    </div>
  );
}

