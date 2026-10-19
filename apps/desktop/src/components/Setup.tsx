import installSql from "../../../../supabase/install.sql?raw";
import { useState } from "react";
import { checkServer, decodeConnectionCode, saveServerConfig, validAnonKey, validServerUrl, type ServerConfig } from "../lib/config";

const INPUT = "w-full rounded-md border border-line bg-raised px-2 py-1.5 outline-none focus:border-accent";

/**
 * Primeira execução: escolher o servidor (Supabase) do Cooper.
 * Quem foi convidado cola o código de conexão; quem começa um time cria o próprio projeto Supabase.
 */
export function Setup() {
  const [mode, setMode] = useState<"choose" | "code" | "create">("choose");

  return (
    <div className="flex h-full flex-col overflow-y-auto p-5">
      <h1 className="text-[15px] font-semibold">Bem-vindo ao Cooper</h1>
      <p className="mt-0.5 mb-4 text-muted">Primeiro, escolha o servidor do seu time. Ele guarda tarefas, contexto e quem está fazendo o quê.</p>

      {mode === "choose" && (
        <div className="space-y-2">
          <Choice title="Tenho um código de conexão" text="Alguém do time te convidou e mandou um código que começa com cooper1." onClick={() => setMode("code")} />
          <Choice title="Criar meu servidor" text="Você começa o time: cria um projeto grátis no Supabase (uns 5 minutos)." onClick={() => setMode("create")} />
        </div>
      )}
      {mode === "code" && <CodeForm onBack={() => setMode("choose")} />}
      {mode === "create" && <CreateGuide onBack={() => setMode("choose")} />}
    </div>
  );
}

function Choice({ title, text, onClick }: { title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full rounded-xl border border-line bg-panel p-3 text-left transition-colors hover:border-accent">
      <div className="font-semibold">{title}</div>
      <div className="mt-0.5 text-[10.5px] leading-snug text-muted">{text}</div>
    </button>
  );
}

/** Confere o servidor e grava (o app recarrega). */
function useConnect() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function connect(c: ServerConfig) {
    setBusy(true);
    setErr(null);
    try {
      const r = await checkServer(c);
      if (!r.ok) return setErr(r.reason);
      saveServerConfig(c);
    } finally {
      setBusy(false);
    }
  }
  return { busy, err, setErr, connect };
}

function CodeForm({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState("");
  const { busy, err, setErr, connect } = useConnect();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        const c = decodeConnectionCode(code);
        if (!c) return setErr("Código inválido. Ele começa com cooper1. e vem inteiro, sem espaços no meio.");
        void connect(c);
      }}
    >
      <label className="block font-medium" htmlFor="code">
        Código de conexão
      </label>
      <textarea id="code" required rows={4} value={code} onChange={(e) => setCode(e.target.value)} placeholder="cooper1.…" className={`${INPUT} resize-none font-mono text-[10.5px] break-all`} />
      {err && <p className="text-[10.5px] leading-snug text-danger">{err}</p>}
      <Actions busy={busy} onBack={onBack} />
    </form>
  );
}

const STEPS: { title: string; text: React.ReactNode }[] = [
  { title: "Crie um projeto grátis", text: <>Em <Mono>supabase.com</Mono> → New project. Guarde a senha do banco no seu gerenciador de senhas.</> },
  {
    title: "Deixe a confirmação de e-mail ligada",
    text: (
      <>
        Authentication → Sign In / Providers → Email: <b>Confirm email</b> ligado. O convite confia no e-mail da conta; sem confirmação, alguém poderia se
        cadastrar com o e-mail de outra pessoa.
      </>
    ),
  },
  {
    title: "Código para trocar a senha",
    text: (
      <>
        Authentication → Emails → <b>Reset Password</b>: inclua <Mono>{"{{ .Token }}"}</Mono> no texto. É o código de 6 dígitos que o app pede em "Esqueci a
        senha".
      </>
    ),
  },
  { title: "Instale o Cooper no banco", text: <>SQL Editor → New query → cole o SQL de instalação (botão abaixo) → Run.</> },
  { title: "Copie o endereço e a chave", text: <>Project Settings → API: <b>Project URL</b> e a chave <b>anon public</b> (nunca a service_role).</> },
];

function CreateGuide({ onBack }: { onBack: () => void }) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [copied, setCopied] = useState(false);
  const { busy, err, setErr, connect } = useConnect();

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const u = validServerUrl(url);
        if (!u) return setErr("URL inválida. Use a Project URL, no formato https://xxxx.supabase.co.");
        const k = validAnonKey(key);
        if (!k) return setErr("Chave inválida. Use a chave anon public (começa com eyJ ou sb_publishable_), não a service_role.");
        void connect({ url: u, anonKey: k });
      }}
    >
      <ol className="space-y-2">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-2">
            <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-raised text-[10px] font-semibold">{i + 1}</span>
            <div className="min-w-0">
              <div className="font-medium">{s.title}</div>
              <p className="text-[10.5px] leading-snug text-muted">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => void navigator.clipboard.writeText(installSql).then(() => setCopied(true))}
        className="w-full rounded-md border border-line py-1 hover:bg-raised"
      >
        {copied ? "SQL copiado: cole no SQL Editor" : `Copiar SQL de instalação (${Math.round(installSql.length / 1024)} KB)`}
      </button>
      <div className="space-y-1.5">
        <input required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Project URL (https://xxxx.supabase.co)" className={INPUT} />
        <input required value={key} onChange={(e) => setKey(e.target.value)} placeholder="Chave anon public" className={`${INPUT} font-mono text-[10.5px]`} />
      </div>
      {err && <p className="text-[10.5px] leading-snug text-danger">{err}</p>}
      <Actions busy={busy} onBack={onBack} />
    </form>
  );
}

function Actions({ busy, onBack }: { busy: boolean; onBack: () => void }) {
  return (
    <div className="flex gap-2">
      <button type="button" onClick={onBack} className="rounded-md px-3 py-1.5 text-muted hover:text-text">
        Voltar
      </button>
      <button disabled={busy} className="flex-1 rounded-md bg-accent py-1.5 font-medium text-white disabled:opacity-50">
        {busy ? "Conferindo o servidor…" : "Conectar"}
      </button>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-raised px-1 font-mono text-[10px] select-text">{children}</code>;
}
