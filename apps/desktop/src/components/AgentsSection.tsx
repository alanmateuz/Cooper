import { AGENT_KINDS, AGENT_LABELS, type AgentKind } from "@cooper/shared";
import { useCallback, useEffect, useState } from "react";
import { timeAgo } from "../lib/format";
import { serverConfig, supabase } from "../lib/supabase";
import { inTauri } from "../lib/window";

interface Connection {
  id: string;
  agent_kind: AgentKind;
  label: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const CLIENT_ARG: Partial<Record<AgentKind, string>> = { claude_code: "claude-code", codex: "codex" };

function clientCommand(kind: AgentKind, token: string, serverPath: string): string {
  const env = [`COOPER_TOKEN=${token}`, `COOPER_SUPABASE_URL=${serverConfig?.url ?? ""}`, `COOPER_SUPABASE_ANON_KEY=${serverConfig?.anonKey ?? ""}`]
    .map((e) => `--env ${e}`)
    .join(" ");
  const server = `-- node "${serverPath}"`;
  if (kind === "codex") return `codex mcp add cooper ${env} ${server}`;
  // Claude Code e outros: escopo de usuário (vale em todos os projetos, nada escrito nos repositórios)
  return `claude mcp add --scope user ${env} --transport stdio cooper ${server}`;
}

const WHERE: Partial<Record<AgentKind, string>> = { codex: "~/.codex/config.toml", claude_code: "~/.claude.json" };

/** Configurações → Agentes: gerar token por agente, ver uso e revogar. */
export function AgentsSection({ workspaceId, now }: { workspaceId: string; now: Date }) {
  const [list, setList] = useState<Connection[]>([]);
  const [kind, setKind] = useState<AgentKind>("claude_code");
  const [created, setCreated] = useState<{ id: string; token: string; kind: AgentKind } | null>(null);
  const [connected, setConnected] = useState<{ file: string; backup: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("agent_connections")
      .select("id,agent_kind,label,token_prefix,created_at,last_used_at,revoked_at")
      .eq("workspace_id", workspaceId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    setList((data ?? []) as Connection[]);
  }, [workspaceId]);
  useEffect(() => void load(), [load]);

  async function create() {
    setErr(null);
    const { data, error } = await supabase.rpc("create_agent_token", { p_workspace: workspaceId, p_kind: kind, p_label: "widget" });
    if (error) return setErr(error.message);
    setCreated({ id: data.id, token: data.token, kind });
    setCopied(false);
    setConnected(null);
    void load();
  }

  // Grava a entrada "cooper" na configuração do agente (Rust, com backup) e revoga tokens antigos do mesmo agente.
  async function connect() {
    if (!created) return;
    setBusy(true);
    setErr(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const r = await invoke<{ file: string; backup: string | null }>("connect_agent", {
        kind: created.kind,
        token: created.token,
        url: serverConfig?.url ?? "",
        anon: serverConfig?.anonKey ?? "",
      });
      const me = (await supabase.auth.getUser()).data.user?.id;
      if (me) {
        await supabase
          .from("agent_connections")
          .update({ revoked_at: new Date().toISOString() })
          .eq("workspace_id", workspaceId)
          .eq("user_id", me)
          .eq("agent_kind", created.kind)
          .neq("id", created.id)
          .is("revoked_at", null);
      }
      setConnected(r);
      void load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    await supabase.from("agent_connections").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    void load();
  }

  // Caminho do servidor MCP que vem dentro do app instalado (recurso do Tauri).
  const [serverPath, setServerPath] = useState<string | null>(null);
  useEffect(() => {
    if (!inTauri) return;
    void import("@tauri-apps/api/path")
      .then(({ resolveResource }) => resolveResource("mcp/index.js"))
      .then((p) => setServerPath(p.replace(/^\\\\\?\\/, "").replaceAll("\\", "/")))
      .catch(() => setServerPath(null));
  }, []);

  const canAutoConnect = inTauri && !!created && (created.kind === "claude_code" || created.kind === "codex");

  // Comando para colar no PowerShell. Ele mesmo grava na configuração do cliente; a pessoa vê tudo antes.
  const command = !created
    ? ""
    : serverPath
      ? clientCommand(created.kind, created.token, serverPath)
      : `$env:COOPER_TOKEN="${created.token}"; pnpm mcp:config ${CLIENT_ARG[created.kind] ?? "claude-code"}`;

  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] leading-snug text-muted">Conecte o Claude Code ou o Codex ao Cooper.</span>
        <div className="flex shrink-0 gap-1">
          <select value={kind} onChange={(e) => setKind(e.target.value as AgentKind)} className="rounded border border-line bg-raised px-1 py-0.5">
            {AGENT_KINDS.map((k) => (
              <option key={k} value={k}>{AGENT_LABELS[k]}</option>
            ))}
          </select>
          <button type="button" onClick={() => void create()} className="rounded-md bg-accent px-2 text-white">
            Gerar token
          </button>
        </div>
      </div>
      {err && <p className="text-[10.5px] text-red-400">{err}</p>}

      {created && (
        <div className="space-y-1.5 rounded-md border border-accent/50 bg-raised p-2">
          {connected ? (
            <>
              <p className="text-[10.5px] leading-snug text-run">
                Pronto! {AGENT_LABELS[created.kind]} conectado. Abra uma <b>conversa nova</b> nele e peça: “use o cooper: quais são minhas
                tarefas?”
              </p>
              <p className="text-[10px] leading-snug text-muted">
                Gravado em <code>{connected.file}</code>
                {connected.backup && <> (backup: <code>{connected.backup.split(/[\\/]/).pop()}</code>)</>}. Tokens antigos deste agente
                foram revogados.
              </p>
            </>
          ) : canAutoConnect ? (
            <>
              <p className="text-[10.5px] leading-snug">
                Token de <b>{AGENT_LABELS[created.kind]}</b> criado. Clique para o Cooper gravar a conexão em{" "}
                <code>{WHERE[created.kind]}</code> (faz backup antes). Precisa do Node.js 20+.
              </p>
              <button type="button" disabled={busy} onClick={() => void connect()} className="w-full rounded-md bg-accent py-1 font-medium text-white disabled:opacity-50">
                {busy ? "Conectando…" : `Conectar ao ${AGENT_LABELS[created.kind]}`}
              </button>
            </>
          ) : (
            <p className="text-[10.5px] leading-snug">
              Token de <b>{AGENT_LABELS[created.kind]}</b>. <b>Aparece só agora</b>; o Cooper guarda apenas o hash. Use o comando abaixo.
            </p>
          )}
          <details open={!canAutoConnect && !connected}>
            <summary className="cursor-pointer text-[10px] text-muted hover:text-text">Prefiro copiar o comando (terminal)</summary>
            <code className="mt-1 block max-h-16 overflow-y-auto rounded bg-bg p-1.5 text-[10px] break-all select-text">{command}</code>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(command).then(() => setCopied(true))}
              className="mt-1 rounded border border-line px-2 py-0.5 hover:bg-bg"
            >
              {copied ? "Copiado" : "Copiar comando"}
            </button>
          </details>
          <button type="button" onClick={() => setCreated(null)} className="text-[10px] text-muted hover:text-text">
            Fechar
          </button>
        </div>
      )}

      {list.length === 0 && !created && <p className="text-[10.5px] text-muted">Nenhum agente conectado.</p>}
      {list.map((c) => (
        <div key={c.id} className="flex items-center gap-1.5 text-[10.5px]">
          <span className="w-20 shrink-0">{AGENT_LABELS[c.agent_kind]}</span>
          <code className="text-muted">{c.token_prefix}…</code>
          <span className="flex-1 truncate text-muted">{c.last_used_at ? `usado ${timeAgo(c.last_used_at, now)}` : "nunca usado"}</span>
          <button type="button" onClick={() => void revoke(c.id)} className="text-muted hover:text-red-400">
            revogar
          </button>
        </div>
      ))}
    </section>
  );
}
