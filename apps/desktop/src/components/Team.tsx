import { useCallback, useEffect, useState } from "react";
import { acceptInvite, cancelInvite, createWorkspace, deleteWorkspace, inviteMember, removeMember, renameWorkspace, updateProfile } from "../lib/api";
import { encodeConnectionCode } from "../lib/config";
import { friendlyError } from "../lib/errors";
import { timeAgo } from "../lib/format";
import { shortName } from "../lib/names";
import { AVATAR_COLORS } from "../lib/people";
import { serverConfig, supabase } from "../lib/supabase";
import type { WorkspaceData } from "../lib/useWorkspace";
import { ConfirmBar } from "./ui";

const INPUT = "min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-1 outline-none focus:border-accent";

interface PendingInvite {
  id: string;
  workspace_name: string;
  invited_by_name: string | null;
  created_at: string;
}

/** Convites recebidos (para o e-mail da conta logada), com botão de aceitar. */
export function PendingInvites({ onAccepted }: { onAccepted: (workspaceId: string) => void }) {
  const [list, setList] = useState<PendingInvite[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("my_pending_invites");
    if (error) return setErr(friendlyError(error));
    setList((data ?? []) as PendingInvite[]);
  }, []);
  useEffect(() => void load(), [load]);

  if (list.length === 0 && !err) return null;
  return (
    <section className="space-y-1.5">
      <h3 className="font-medium">Convites para você</h3>
      {list.map((i) => (
        <div key={i.id} className="flex items-center gap-2 rounded-md border border-accent/50 bg-raised px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{i.workspace_name}</div>
            {i.invited_by_name && <div className="text-[10.5px] text-muted">de {i.invited_by_name}</div>}
          </div>
          <button
            type="button"
            className="rounded-md bg-accent px-2 py-0.5 text-white"
            onClick={async () => {
              setErr(null);
              const r = await acceptInvite(i.id);
              if ("error" in r) return setErr(r.error);
              onAccepted(r.workspaceId);
            }}
          >
            Entrar
          </button>
        </div>
      ))}
      {err && <p className="text-[10.5px] text-danger">{err}</p>}
    </section>
  );
}

/** Criar workspace novo (quem cria vira dono). */
export function CreateWorkspace({ me, onCreated }: { me: string; onCreated: (workspaceId: string) => void }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-1"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        setBusy(true);
        try {
          const r = await createWorkspace(name, me);
          if ("error" in r) return setErr(r.error);
          setName("");
          onCreated(r.id);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex gap-1.5">
        <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do projeto (ex.: Hacko)" className={INPUT} />
        <button disabled={busy} className="rounded-md bg-accent px-2 text-white disabled:opacity-40">
          Criar
        </button>
      </div>
      {err && <p className="text-[10.5px] text-danger">{err}</p>}
    </form>
  );
}

/** Tela de quem ainda não participa de nenhum workspace. */
export function Onboarding({ me, onReady }: { me: string; onReady: (workspaceId: string) => void }) {
  return (
    <div className="flex h-full flex-col justify-center gap-5 p-5">
      <PendingInvites onAccepted={onReady} />
      <section className="space-y-1.5">
        <h3 className="text-[10.5px] font-semibold tracking-wide text-muted uppercase">Começar um projeto</h3>
        <CreateWorkspace me={me} onCreated={onReady} />
      </section>
      <p className="text-[10.5px] leading-snug text-muted">Foi convidado e não aparece nada? Peça para te convidarem com o mesmo e-mail desta conta.</p>
    </div>
  );
}

/** Ajustes → Projeto: renomear e apagar (dono) ou sair (membro). */
export function ProjectSection({ data, me, onChanged }: { data: WorkspaceData; me: string; onChanged: (keepId?: string) => void }) {
  const ws = data.workspace!;
  const isOwner = data.members.some((m) => m.user_id === me && m.role === "owner");
  const [name, setName] = useState(ws.name);
  const [confirm, setConfirm] = useState<"delete" | "leave" | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setName(ws.name), [ws.name]);

  async function run(action: () => Promise<string | null>, after: () => void) {
    setBusy(true);
    setErr(null);
    try {
      const error = await action();
      if (error) return setErr(error);
      after();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {isOwner ? (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && name.trim() !== ws.name) void run(() => renameWorkspace(ws.id, name), () => onChanged(ws.id));
          }}
        >
          <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome do projeto" className={INPUT} />
          <button disabled={busy || !name.trim() || name.trim() === ws.name} className="rounded-md border border-line px-2 hover:bg-raised disabled:opacity-40">
            Renomear
          </button>
        </form>
      ) : (
        <p className="text-muted">
          Projeto <b className="text-text">{ws.name}</b>. Só o dono renomeia ou apaga.
        </p>
      )}

      {confirm === "delete" && (
        <ConfirmBar
          text={
            <>
              Apagar <b>{ws.name}</b> para todo mundo? Tarefas, contexto, histórico e tokens dos agentes somem. Digite o nome do projeto para confirmar.
            </>
          }
          confirmLabel="Apagar projeto"
          busy={busy}
          disabled={typed.trim() !== ws.name}
          error={err}
          onCancel={() => {
            setConfirm(null);
            setTyped("");
          }}
          onConfirm={() => void run(() => deleteWorkspace(ws.id), () => onChanged())}
        >
          <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={ws.name} aria-label="Nome do projeto para confirmar" className={`${INPUT} w-full`} />
        </ConfirmBar>
      )}
      {confirm === "leave" && (
        <ConfirmBar
          text={
            <>
              Sair de <b>{ws.name}</b>? Seus tokens de agente deste projeto são revogados e seu uso compartilhado é apagado. Para voltar, precisa de um novo
              convite.
            </>
          }
          confirmLabel="Sair do projeto"
          busy={busy}
          error={err}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void run(() => removeMember(ws.id, me), () => onChanged())}
        />
      )}
      {!confirm && (
        <button
          type="button"
          onClick={() => setConfirm(isOwner ? "delete" : "leave")}
          className="w-full rounded-md border border-line py-1 text-muted transition-colors hover:border-danger/50 hover:bg-danger/10 hover:text-danger"
        >
          {isOwner ? "Apagar projeto…" : "Sair do projeto…"}
        </button>
      )}
      {err && !confirm && <p className="text-[10.5px] text-danger">{err}</p>}
    </div>
  );
}

interface Invite {
  id: string;
  email: string;
  created_at: string;
  accepted_at: string | null;
}

/** Ajustes → Equipe: seu nome e cor, membros (dono remove), convites e código de conexão. */
export function MembersSection({ data, me, now, onProfileChange }: { data: WorkspaceData; me: string; now: Date; onProfileChange?: () => void }) {
  const ws = data.workspace!;
  const isOwner = data.members.some((m) => m.user_id === me && m.role === "owner");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: rows, error } = await supabase
      .from("workspace_invites")
      .select("id,email,created_at,accepted_at")
      .eq("workspace_id", ws.id)
      .is("accepted_at", null)
      .order("created_at", { ascending: false });
    if (error) return setMsg({ ok: false, text: friendlyError(error) });
    setInvites((rows ?? []) as Invite[]);
  }, [ws.id]);
  useEffect(() => void load(), [load]);

  const removingMember = data.members.find((m) => m.user_id === removing);

  return (
    <section className="space-y-2">
      <DisplayNameEditor data={data} me={me} onChange={onProfileChange} />
      <ColorPicker data={data} me={me} onChange={onProfileChange} />
      <div className="space-y-1">
        {data.members.map((m) => (
          <div key={m.user_id} className="flex items-center gap-1.5 text-[10.5px]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: m.profile?.avatar_color ?? "#64748b" }} />
            <span className="flex-1 truncate">
              {m.profile?.display_name ?? "—"}
              {m.user_id === me && <span className="text-muted"> (você)</span>}
            </span>
            <span className="text-muted">{m.role === "owner" ? "dono" : "membro"}</span>
            {isOwner && m.user_id !== me && (
              <button type="button" onClick={() => setRemoving(m.user_id)} className="text-muted hover:text-danger">
                remover
              </button>
            )}
          </div>
        ))}
      </div>
      {removingMember && (
        <ConfirmBar
          text={`Remover ${removingMember.profile?.display_name ?? "esta pessoa"} do projeto? Os tokens de agente dela são revogados e o uso compartilhado é apagado.`}
          confirmLabel="Remover"
          busy={busy}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              const error = await removeMember(ws.id, removingMember.user_id);
              setMsg(error ? { ok: false, text: error } : null);
              if (!error) setRemoving(null);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {invites.map((i) => (
        <div key={i.id} className="flex items-center gap-1.5 text-[10.5px] text-muted">
          <span className="h-2 w-2 rounded-full border border-dashed border-idle" />
          <span className="flex-1 truncate">{i.email}</span>
          <span>convidado {timeAgo(i.created_at, now)}</span>
          {isOwner && (
            <button
              type="button"
              className="hover:text-danger"
              onClick={async () => {
                const error = await cancelInvite(i.id);
                if (error) setMsg({ ok: false, text: error });
                void load();
              }}
            >
              cancelar
            </button>
          )}
        </div>
      ))}
      {isOwner && (
        <form
          className="flex gap-1.5 pt-0.5"
          onSubmit={async (e) => {
            e.preventDefault();
            setMsg(null);
            const clean = email.trim().toLowerCase();
            const error = await inviteMember(ws.id, clean, me);
            if (error) return setMsg({ ok: false, text: error });
            setEmail("");
            setMsg({
              ok: true,
              text: `Convite criado. Mande para ${clean} o instalador do Cooper e o código de conexão (botão abaixo). Ela cola o código na primeira tela, cria a conta com esse e-mail e aceita o convite.`,
            });
            void load();
          }}
        >
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e-mail para convidar" className={INPUT} />
          <button className="rounded-md bg-accent px-2 text-white">Convidar</button>
        </form>
      )}
      {msg && <p className={`text-[10.5px] leading-snug ${msg.ok ? "text-run" : "text-danger"}`}>{msg.text}</p>}
      <ConnectionCodeButton />
    </section>
  );
}

/** Seu nome de exibição, visto por todo o time. */
function DisplayNameEditor({ data, me, onChange }: { data: WorkspaceData; me: string; onChange?: () => void }) {
  const current = data.members.find((m) => m.user_id === me)?.profile?.display_name ?? "";
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setName(current), [current]);
  const clean = name.trim();
  return (
    <form
      className="space-y-1"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!clean || clean === current) return;
        setBusy(true);
        setErr(null);
        try {
          const error = await updateProfile(me, { display_name: clean });
          if (error) return setErr(error);
          onChange?.();
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="font-medium" htmlFor="display-name">
        Seu nome
      </label>
      <div className="flex gap-1.5">
        <input id="display-name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
        <button disabled={busy || !clean || clean === current} className="rounded-md border border-line px-2 hover:bg-raised disabled:opacity-40">
          Salvar
        </button>
      </div>
      {err && <p className="text-[10.5px] text-danger">{err}</p>}
    </form>
  );
}

/** Código que aponta para o servidor deste time: quem foi convidado cola na primeira tela do Cooper. */
function ConnectionCodeButton() {
  const [copied, setCopied] = useState(false);
  if (!serverConfig) return null;
  const code = encodeConnectionCode(serverConfig);
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard.writeText(code).then(() => setCopied(true))}
      className="w-full rounded-md border border-line py-1 text-[10.5px] hover:bg-raised"
      title="Só tem o endereço do servidor e a chave pública; não dá acesso a nada sem conta e convite."
    >
      {copied ? "Código copiado: mande junto com o instalador" : "Copiar código de conexão"}
    </button>
  );
}

/** Sua cor no avatar, vista por todo o time. Cor de outra pessoa do workspace fica bloqueada e mostra a inicial dela. */
function ColorPicker({ data, me, onChange }: { data: WorkspaceData; me: string; onChange?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const mine = data.members.find((m) => m.user_id === me)?.profile?.avatar_color?.toLowerCase();
  const taken = new Map(data.members.filter((m) => m.user_id !== me && m.profile).map((m) => [m.profile!.avatar_color.toLowerCase(), shortName(m.profile!.display_name)]));
  async function pick(color: string) {
    setBusy(true);
    setErr(null);
    try {
      const error = await updateProfile(me, { avatar_color: color });
      if (error) return setErr(error);
      onChange?.();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-1.5 pb-1">
      <span className="font-medium">Sua cor</span>
      <div className="flex flex-wrap gap-1.5">
        {AVATAR_COLORS.map((c) => {
          const owner = taken.get(c);
          const selected = mine === c;
          return (
            <button
              key={c}
              type="button"
              disabled={busy || !!owner}
              onClick={() => void pick(c)}
              title={owner ? `Cor de ${owner}` : selected ? "Sua cor" : "Usar esta cor"}
              aria-label={owner ? `Cor de ${owner}` : `Cor ${c}`}
              aria-pressed={selected}
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white transition-transform disabled:cursor-not-allowed ${
                selected ? "ring-2 ring-text ring-offset-2 ring-offset-panel" : owner ? "opacity-40" : "hover:scale-110"
              }`}
              style={{ background: c }}
            >
              {owner ? owner[0]?.toUpperCase() : ""}
            </button>
          );
        })}
      </div>
      {taken.size > 0 && <p className="text-[10.5px] leading-snug text-muted">Cores com uma letra já são de alguém do time.</p>}
      {err && <p className="text-[10.5px] text-danger">{err}</p>}
    </div>
  );
}
