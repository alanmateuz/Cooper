import { useCallback, useEffect, useState } from "react";
import { timeAgo } from "../lib/format";
import { supabase } from "../lib/supabase";
import { AVATAR_COLORS } from "../lib/people";
import type { WorkspaceData } from "../lib/useWorkspace";

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
    const { data } = await supabase.rpc("my_pending_invites");
    setList((data ?? []) as PendingInvite[]);
  }, []);
  useEffect(() => void load(), [load]);

  if (list.length === 0) return null;
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
              const { data, error } = await supabase.rpc("accept_invite", { p_invite: i.id });
              if (error) return setErr(error.message);
              onAccepted(data as string);
            }}
          >
            Entrar
          </button>
        </div>
      ))}
      {err && <p className="text-[10.5px] text-red-400">{err}</p>}
    </section>
  );
}

/** Criar workspace novo (quem cria vira dono). */
export function CreateWorkspace({ me, onCreated }: { me: string; onCreated: (workspaceId: string) => void }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="flex gap-1.5"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        const { data, error } = await supabase.from("workspaces").insert({ name: name.trim(), created_by: me }).select("id").single();
        if (error) return setErr(error.message);
        setName("");
        onCreated(data.id);
      }}
    >
      <input
        required
        maxLength={80}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nome do projeto (ex.: Hacko)"
        className="min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-1 outline-none focus:border-accent"
      />
      <button className="rounded-md bg-accent px-2 text-white">Criar</button>
      {err && <p className="text-[10.5px] text-red-400">{err}</p>}
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
      <p className="text-[10.5px] leading-snug text-muted">
        Foi convidado e não aparece nada? Peça para te convidarem com o mesmo e-mail desta conta.
      </p>
    </div>
  );
}

interface Invite {
  id: string;
  email: string;
  created_at: string;
  accepted_at: string | null;
}

/** Configurações → Membros: lista, convites pendentes e convidar por e-mail (só dono convida). */
export function MembersSection({ data, me, now, onProfileChange }: { data: WorkspaceData; me: string; now: Date; onProfileChange?: () => void }) {
  const ws = data.workspace!;
  const isOwner = data.members.some((m) => m.user_id === me && m.role === "owner");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data: rows } = await supabase
      .from("workspace_invites")
      .select("id,email,created_at,accepted_at")
      .eq("workspace_id", ws.id)
      .is("accepted_at", null)
      .order("created_at", { ascending: false });
    setInvites((rows ?? []) as Invite[]);
  }, [ws.id]);
  useEffect(() => void load(), [load]);

  return (
    <section className="space-y-1.5">
      <ColorPicker data={data} me={me} onChange={onProfileChange} />
      {data.members.map((m) => (
        <div key={m.user_id} className="flex items-center gap-1.5 text-[10.5px]">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: m.profile?.avatar_color ?? "#64748b" }} />
          <span className="flex-1 truncate">
            {m.profile?.display_name ?? "—"}
            {m.user_id === me && <span className="text-muted"> (você)</span>}
          </span>
          <span className="text-muted">{m.role === "owner" ? "dono" : "membro"}</span>
        </div>
      ))}
      {invites.map((i) => (
        <div key={i.id} className="flex items-center gap-1.5 text-[10.5px] text-muted">
          <span className="h-2 w-2 rounded-full border border-dashed border-idle" />
          <span className="flex-1 truncate">{i.email}</span>
          <span>convidado {timeAgo(i.created_at, now)}</span>
          {isOwner && (
            <button
              type="button"
              className="hover:text-red-400"
              onClick={async () => {
                await supabase.from("workspace_invites").delete().eq("id", i.id);
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
            const { error } = await supabase.from("workspace_invites").insert({ workspace_id: ws.id, email: clean, invited_by: me });
            if (error) return setMsg({ ok: false, text: error.code === "23505" ? "Esse e-mail já foi convidado." : error.message });
            setEmail("");
            setMsg({ ok: true, text: `Convite criado. Avise ${clean} para instalar o Cooper e entrar com esse e-mail.` });
            void load();
          }}
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="e-mail para convidar"
            className="min-w-0 flex-1 rounded border border-line bg-raised px-1.5 py-0.5 outline-none focus:border-accent"
          />
          <button className="rounded-md bg-accent px-2 text-white">Convidar</button>
        </form>
      )}
      {msg && <p className={`text-[10.5px] leading-snug ${msg.ok ? "text-run" : "text-red-400"}`}>{msg.text}</p>}
    </section>
  );
}

/** Sua cor no avatar, vista por todo o time. Cor de outra pessoa do workspace fica bloqueada e mostra a inicial dela. */
function ColorPicker({ data, me, onChange }: { data: WorkspaceData; me: string; onChange?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const mine = data.members.find((m) => m.user_id === me)?.profile?.avatar_color?.toLowerCase();
  const taken = new Map(
    data.members.filter((m) => m.user_id !== me && m.profile).map((m) => [m.profile!.avatar_color.toLowerCase(), m.profile!.display_name.replace(/\s*\(.*\)/, "")]),
  );
  async function pick(color: string) {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.from("profiles").update({ avatar_color: color }).eq("id", me);
    setBusy(false);
    if (error) return setErr(error.message);
    onChange?.();
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
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white transition-transform disabled:cursor-not-allowed ${
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
