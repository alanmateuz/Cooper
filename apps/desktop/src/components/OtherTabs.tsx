import { AGENT_LABELS, type Workspace } from "@cooper/shared";
import { useState } from "react";
import { timeAgo } from "../lib/format";
import { supabase } from "../lib/supabase";
import type { WorkspaceData } from "../lib/useWorkspace";
import { AgentsSection } from "./AgentsSection";
import { ClaudeStatusLine } from "./ClaudeStatusLine";
import { ProjectInstructions } from "./ProjectInstructions";
import { describeEvent } from "./TasksTab";
import { Icon, SourceBadge } from "./ui";

const KIND_LABEL = { summary: "Resumo", architecture: "Arquitetura", convention: "Convenção" } as const;

export function ContextTab({ data }: { data: WorkspaceData }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (data.context.length === 0) return <Empty>Nenhum contexto cadastrado.</Empty>;
  return (
    <div className="h-full space-y-1 overflow-y-auto p-2">
      {data.context.map((c) => {
        const isOpen = open[c.id] ?? c.kind === "summary";
        return (
          <section key={c.id} className="rounded-md border border-line bg-panel">
            <button type="button" onClick={() => setOpen((o) => ({ ...o, [c.id]: !isOpen }))} className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left">
              <span className={`text-muted transition-transform ${isOpen ? "rotate-90" : ""}`}>
                <Icon name="chevron" size={10} />
              </span>
              <span className="flex-1 font-medium">{c.title}</span>
              <span className="text-[10px] text-muted">{KIND_LABEL[c.kind]}</span>
            </button>
            {isOpen && <p className="px-2 pb-2 pl-[22px] leading-snug whitespace-pre-wrap text-muted">{c.body}</p>}
          </section>
        );
      })}
    </div>
  );
}

export function ActivityTab({ data, now }: { data: WorkspaceData; now: Date }) {
  if (data.events.length === 0) return <Empty>Nenhum evento ainda.</Empty>;
  const name = (id: string | null) => data.members.find((m) => m.user_id === id)?.profile?.display_name.replace(/\s*\(.*\)/, "") ?? "—";
  const task = (id: string | null) => data.tasks.find((t) => t.id === id);
  return (
    <ol className="h-full overflow-y-auto p-2">
      {data.events.map((e) => {
        const t = task(e.task_id);
        const session = data.sessions.find((s) => s.id === e.agent_session_id);
        return (
          <li key={e.id} className="flex gap-2 border-b border-line/60 py-1.5 last:border-0">
            <span className="w-12 shrink-0 pt-px text-[10px] text-muted" title={e.occurred_at}>
              {timeAgo(e.occurred_at, now)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate">
                <span className="font-medium">{name(e.user_id)}</span>
                {session && <span className="text-muted"> · {AGENT_LABELS[session.agent_kind]}</span>}
                <span className="text-muted"> · {describeEvent(e.type, e.payload, name)}</span>
              </div>
              {t && <div className="truncate text-[10.5px] text-muted">#{t.number} {t.title}</div>}
            </div>
            <SourceBadge source={e.source} />
          </li>
        );
      })}
    </ol>
  );
}

export function SettingsTab({
  workspace,
  workspaces,
  onSelect,
  email,
  theme,
  setTheme,
  dim,
  setDim,
  paused,
  now,
  children,
}: {
  workspace: Workspace;
  workspaces: Workspace[];
  onSelect: (w: Workspace) => void;
  email: string;
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;
  dim: boolean;
  setDim: (v: boolean) => void;
  paused: boolean;
  now: Date;
  children?: React.ReactNode;
}) {
  return (
    <div className="h-full space-y-3 overflow-y-auto p-3">
      <Row label="Workspace">
        <select value={workspace.id} onChange={(e) => onSelect(workspaces.find((w) => w.id === e.target.value)!)} className="rounded border border-line bg-raised px-1 py-0.5">
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </Row>
      <Row label="Conta">
        <span className="truncate text-muted">{email}</span>
      </Row>
      <Row label="Tema">
        <select value={theme} onChange={(e) => setTheme(e.target.value as "dark" | "light")} className="rounded border border-line bg-raised px-1 py-0.5">
          <option value="dark">Escuro</option>
          <option value="light">Claro</option>
        </select>
      </Row>
      <Row label="Esmaecer fora do foco">
        <input type="checkbox" checked={dim} onChange={(e) => setDim(e.target.checked)} />
      </Row>
      <Row label="Sincronização">
        <span className={paused ? "text-warn" : "text-muted"}>{paused ? "pausada (bandeja)" : "ativa"}</span>
      </Row>
      {children}
      <AgentsSection workspaceId={workspace.id} now={now} />
      <ProjectInstructions />
      <ClaudeStatusLine />
      <p className="text-[10.5px] leading-snug text-muted">Repositório e hooks entram nas etapas de git e hooks.</p>
      <button type="button" onClick={() => void supabase.auth.signOut()} className="rounded-md border border-line px-2 py-1 hover:bg-raised">
        Sair
      </button>
    </div>
  );
}

/** ⚙ → Privacidade. Compartilhar uso é opcional e começa desligado; desligar apaga o que já foi enviado. */
export function PrivacySection({ workspaceId, sharing }: { workspaceId: string; sharing: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function toggle(on: boolean) {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("set_usage_sharing", { p_workspace: workspaceId, p_on: on });
    setBusy(false);
    if (error) setErr(error.message);
  }
  return (
    <section className="space-y-1">
      <span className="font-medium">Privacidade</span>
      <label className="flex items-start gap-1.5">
        <input type="checkbox" className="mt-0.5" checked={sharing} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
        <span>
          Compartilhar meu uso de IA com o time
          <span className="block text-[10.5px] leading-snug text-muted">
            Só números do dia: tokens, modelo e percentual de limite. Prompts, respostas e código nunca saem da sua máquina. Desligar apaga o
            que já foi enviado.
          </span>
        </span>
      </label>
      {err && <p className="text-[10.5px] text-red-400">{err}</p>}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center p-6 text-center text-muted">{children}</div>;
}
