import type {
  AgentSession,
  AiUsageRow,
  ContextBlock,
  GitSnapshot,
  Profile,
  Task,
  TaskEvent,
  TaskLink,
  Workspace,
  WorkspaceMember,
} from "@cooper/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { friendlyError } from "./errors";
import { distinctColors } from "./people";
import { supabase } from "./supabase";

export interface WorkspaceData {
  workspace: Workspace | null;
  members: (WorkspaceMember & { profile: Profile | null })[];
  tasks: Task[];
  sessions: AgentSession[];
  snapshots: GitSnapshot[];
  events: TaskEvent[];
  /** Blocos de contexto, inclusive apagados (deleted_at), para poder desfazer. */
  context: ContextBlock[];
  links: TaskLink[];
  /** Uso de IA compartilhado pelos membros (só de quem ligou o compartilhamento). */
  usage: AiUsageRow[];
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
  usage: [],
};

/** Resultado de uma consulta: as linhas, ou lança o erro (os loaders não engolem mais falhas). */
async function fetchRows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as T[];
}

type Table =
  | "tasks"
  | "agent_sessions"
  | "git_snapshots"
  | "task_events"
  | "context_blocks"
  | "workspace_members"
  | "task_links"
  | "ai_usage";

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
  /** Falha ao atualizar uma tabela depois de carregado (rede, permissão): o widget mostra um aviso discreto. */
  const [syncError, setSyncError] = useState<string | null>(null);
  const wsId = data.workspace?.id ?? null;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const loaders: Record<Table, (id: string) => Promise<Partial<WorkspaceData>>> = {
    tasks: async (id) => ({
      tasks: await fetchRows<Task>(supabase.from("tasks").select("*").eq("workspace_id", id).order("number")),
    }),
    agent_sessions: async (id) => ({
      sessions: await fetchRows<AgentSession>(supabase
        .from("agent_sessions")
        .select("*")
        .eq("workspace_id", id)
        .order("last_event_at", { ascending: false, nullsFirst: false })
        .limit(50)),
    }),
    git_snapshots: async (id) => ({
      snapshots: await fetchRows<GitSnapshot>(supabase.from("git_snapshots").select("*").eq("workspace_id", id)),
    }),
    task_events: async (id) => ({
      events: await fetchRows<TaskEvent>(supabase
        .from("task_events")
        .select("*")
        .eq("workspace_id", id)
        .order("occurred_at", { ascending: false })
        .limit(80)),
    }),
    context_blocks: async (id) => ({
      context: await fetchRows<ContextBlock>(supabase.from("context_blocks").select("*").eq("workspace_id", id).order("position")),
    }),
    task_links: async (id) => ({
      links: await fetchRows<TaskLink>(supabase.from("task_links").select("*").eq("workspace_id", id)),
    }),
    ai_usage: async (id) => ({
      usage: await fetchRows<AiUsageRow>(supabase.from("ai_usage").select("*").eq("workspace_id", id)),
    }),
    workspace_members: async (id) => {
      const rows = await fetchRows<WorkspaceMember>(supabase.from("workspace_members").select("*").eq("workspace_id", id));
      const profiles = await fetchRows<Profile>(supabase
        .from("profiles")
        .select("*")
        .in(
          "id",
          rows.map((r) => r.user_id),
        ));
      // cor padrão igual para todos confundia as pessoas: cada uma ganha uma cor distinta no workspace
      const colors = distinctColors(rows.map((r) => ({ user_id: r.user_id, color: profiles.find((p) => p.id === r.user_id)?.avatar_color ?? null })));
      return {
        members: rows.map((m) => {
          const p = profiles.find((x) => x.id === m.user_id);
          return { ...m, profile: p ? { ...p, avatar_color: colors.get(m.user_id) ?? p.avatar_color } : null };
        }),
      };
    },
  };

  const reload = useCallback(
    async (table: Table, id: string) => {
      try {
        const patch = await loaders[table](id);
        setData((d) => (d.workspace?.id === id ? { ...d, ...patch } : d));
        setSyncError(null);
      } catch (e) {
        setSyncError(friendlyError(e));
      }
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
      setError(friendlyError(e));
      setStatus("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lista de workspaces do usuário e escolha do último usado (ou de `preferId`).
  const loadWorkspaces = useCallback(
    async (preferId?: string) => {
      const { data: rows, error: err } = await supabase.from("workspaces").select("*").order("created_at");
      if (err) {
        setError(friendlyError(err));
        setStatus("error");
        return;
      }
      const list = (rows ?? []) as Workspace[];
      setWorkspaces(list);
      if (list.length === 0) return setStatus("empty");
      let saved: string | null = preferId ?? null;
      try {
        saved ??= localStorage.getItem("cooper.workspace");
      } catch {
        /* ignore */
      }
      await selectWorkspace(list.find((w) => w.id === saved) ?? list[0]!);
    },
    [selectWorkspace],
  );
  useEffect(() => void loadWorkspaces(), [loadWorkspaces]);

  // Realtime: uma assinatura por tabela, filtrada pelo workspace.
  useEffect(() => {
    if (!wsId || paused) {
      setRealtime(paused ? "off" : "connecting");
      return;
    }
    const tables = Object.keys(loaders) as Table[];
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

  return { data, workspaces, status, realtime, error, syncError, selectWorkspace, loadWorkspaces, reload };
}
