import { AGENT_KINDS, AGENT_LABELS, type AgentKind } from "@cooper/shared";
import { useCallback, useEffect, useState } from "react";
import { timeAgo } from "../lib/format";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from "../lib/supabase";
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
  const env = [`COOPER_TOKEN=${token}`, `COOPER_SUPABASE_URL=${SUPABASE_URL}`, `COOPER_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}`]
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
  const [created, setCreated] = useState<{ token: string; kind: AgentKind } | null>(null);
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
    setCreated({ token: data.token, kind });
    setCopied(false);
    void load();
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

  // Comando para colar no PowerShell. Ele mesmo grava na configuração do cliente; a pessoa vê tudo antes.
  const command = !created
    ? ""
    : serverPath
      ? clientCommand(created.kind, created.token, serverPath)
      : `$env:COOPER_TOKEN="${created.token}"; pnpm mcp:config ${CLIENT_ARG[created.kind] ?? "claude-code"}`;

  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-medium">Agentes</span>
        <div className="flex gap-1">
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
        <div className="space-y-1 rounded-md border border-accent/50 bg-raised p-2">
          <p className="text-[10.5px] leading-snug">
            Token de <b>{AGENT_LABELS[created.kind]}</b>. <b>Aparece só agora</b>; o Cooper guarda apenas o hash.{" "}
            {serverPath ? (
              <>
                Cole no PowerShell: o comando adiciona o Cooper em <code>{WHERE[created.kind] ?? "configuração do agente"}</code>.
                Precisa do Node.js 20+. Depois, abra uma conversa nova no agente.
              </>
            ) : (
              <>Rode na raiz do repositório do Cooper (PowerShell). Sem <code>--write</code> ele só mostra o que vai gravar:</>
            )}
          </p>
          <code className="block max-h-16 overflow-y-auto rounded bg-bg p-1.5 text-[10px] break-all select-text">{command}</code>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(command).then(() => setCopied(true))}
              className="rounded border border-line px-2 py-0.5 hover:bg-bg"
            >
              {copied ? "Copiado" : "Copiar comando"}
            </button>
            <button type="button" onClick={() => setCreated(null)} className="rounded px-2 py-0.5 text-muted hover:text-text">
              Fechar
            </button>
          </div>
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
