import type {
  AgentSession,
  ContextEntry,
  GitSnapshot,
  Profile,
  Task,
  TaskEvent,
  TaskLink,
  Workspace,
  WorkspaceMember,
} from "@cooper/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

export interface WorkspaceData {
  workspace: Workspace | null;
  members: (WorkspaceMember & { profile: Profile | null })[];
  tasks: Task[];
  sessions: AgentSession[];
  snapshots: GitSnapshot[];
  events: TaskEvent[];
  context: ContextEntry[];
  links: TaskLink[];
}

const EMPTY: WorkspaceData = {
  workspace: null,
  members: [],
  tasks: [],
  sessions: [],
  snapshots: [],
  events: [],
  context: [],
  links: [],
};

type Table = "tasks" | "agent_sessions" | "git_snapshots" | "task_events" | "context_entries" | "workspace_members" | "task_links";

/**
 * Carrega o workspace e mantém tudo atualizado via Realtime.
 * Estratégia simples e robusta: a cada mudança numa tabela, recarrega só aquela tabela.
 */
export function useWorkspace(paused: boolean) {
  const [data, setData] = useState<WorkspaceData>(EMPTY);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [realtime, setRealtime] = useState<"connecting" | "live" | "off">("connecting");
  const [error, setError] = useState<string | null>(null);
  const wsId = data.workspace?.id ?? null;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const loaders: Record<Table, (id: string) => Promise<Partial<WorkspaceData>>> = {
    tasks: async (id) => ({
      tasks: ((await supabase.from("tasks").select("*").eq("workspace_id", id).order("number")).data ?? []) as Task[],
    }),
    agent_sessions: async (id) => ({
      sessions: ((await supabase
        .from("agent_sessions")
        .select("*")
        .eq("workspace_id", id)
        .order("last_event_at", { ascending: false, nullsFirst: false })
        .limit(50)).data ?? []) as AgentSession[],
    }),
    git_snapshots: async (id) => ({
      snapshots: ((await supabase.from("git_snapshots").select("*").eq("workspace_id", id)).data ?? []) as GitSnapshot[],
    }),
    task_events: async (id) => ({
      events: ((await supabase
        .from("task_events")
        .select("*")
        .eq("workspace_id", id)
        .order("occurred_at", { ascending: false })
        .limit(40)).data ?? []) as TaskEvent[],
    }),
    context_entries: async (id) => ({
      context: ((await supabase.from("context_entries").select("*").eq("workspace_id", id).order("position")).data ??
        []) as ContextEntry[],
    }),
    task_links: async (id) => ({
      links: ((await supabase.from("task_links").select("*").eq("workspace_id", id)).data ?? []) as TaskLink[],
    }),
    workspace_members: async (id) => {
      const rows = ((await supabase.from("workspace_members").select("*").eq("workspace_id", id)).data ?? []) as WorkspaceMember[];
      const profiles = ((await supabase
        .from("profiles")
        .select("*")
        .in(
          "id",
          rows.map((r) => r.user_id),
        )).data ?? []) as Profile[];
      return { members: rows.map((m) => ({ ...m, profile: profiles.find((p) => p.id === m.user_id) ?? null })) };
    },
  };

  const reload = useCallback(
    async (table: Table, id: string) => {
      const patch = await loaders[table](id);
      setData((d) => (d.workspace?.id === id ? { ...d, ...patch } : d));
    },
    // loaders só dependem do cliente supabase (estável)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const selectWorkspace = useCallback(async (ws: Workspace) => {
    setStatus("loading");
    try {
      const parts = await Promise.all((Object.keys(loaders) as Table[]).map((t) => loaders[t](ws.id)));
      setData(Object.assign({ ...EMPTY, workspace: ws }, ...parts));
      setStatus("ready");
      try {
        localStorage.setItem("cooper.workspace", ws.id);
      } catch {
        /* ignore */
      }
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lista de workspaces do usuário e escolha do último usado.
  useEffect(() => {
    (async () => {
      const { data: rows, error: err } = await supabase.from("workspaces").select("*").order("created_at");
      if (err) {
        setError(err.message);
        setStatus("error");
        return;
      }
      const list = (rows ?? []) as Workspace[];
      setWorkspaces(list);
      if (list.length === 0) return setStatus("empty");
      let saved: string | null = null;
      try {
        saved = localStorage.getItem("cooper.workspace");
      } catch {
        /* ignore */
      }
      await selectWorkspace(list.find((w) => w.id === saved) ?? list[0]!);
    })();
  }, [selectWorkspace]);

  // Realtime: uma assinatura por tabela, filtrada pelo workspace.
  useEffect(() => {
    if (!wsId || paused) {
      setRealtime(paused ? "off" : "connecting");
      return;
    }
    const tables: Table[] = ["tasks", "agent_sessions", "git_snapshots", "task_events", "context_entries", "workspace_members", "task_links"];
    let channel = supabase.channel(`ws:${wsId}`);
    for (const table of tables) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `workspace_id=eq.${wsId}` }, () => {
        if (!pausedRef.current) void reload(table, wsId);
      });
    }
    channel.subscribe((s) => setRealtime(s === "SUBSCRIBED" ? "live" : s === "CLOSED" ? "off" : "connecting"));
    // Ao retomar depois de pausa, recarrega tudo para não perder mudanças.
    for (const t of tables) void reload(t, wsId);
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [wsId, paused, reload]);

  return { data, workspaces, status, realtime, error, selectWorkspace, reload };
}
