import { useState } from "react";
import { supabase } from "../lib/supabase";

const inputCls = "rounded-md border border-line bg-raised px-2 py-1.5 outline-none focus:border-accent";

export function Login() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setErr(null);
    setInfo(null);
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setErr(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : error.message);
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: name.trim() } },
      });
      if (error) setErr(error.message);
      // Com confirmação de e-mail ligada no Supabase, não há sessão até clicar no link.
      else if (!data.session) {
        setInfo("Enviamos um link de confirmação para o seu e-mail. Clique nele e depois entre aqui.");
        setMode("signin");
      }
    }
    setBusy(false);
  }

  return (
    <form
      className="flex h-full flex-col justify-center gap-2 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h1 className="text-[15px] font-semibold">Cooper</h1>
      <p className="mb-2 text-muted">{mode === "signin" ? "Entre para ver o seu time." : "Crie sua conta."}</p>
      {mode === "signup" && (
        <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="seu nome" className={inputCls} />
      )}
      <input
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="e-mail"
        className={inputCls}
      />
      <input
        type="password"
        autoComplete={mode === "signin" ? "current-password" : "new-password"}
        required
        minLength={mode === "signup" ? 8 : undefined}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={mode === "signup" ? "senha (mín. 8)" : "senha"}
        className={inputCls}
      />
      {err && <p className="text-[10.5px] text-red-400">{err}</p>}
      {info && <p className="text-[10.5px] leading-snug text-run">{info}</p>}
      <button disabled={busy} className="mt-1 rounded-md bg-accent py-1.5 font-medium text-white disabled:opacity-50">
        {busy ? "Aguarde…" : mode === "signin" ? "Entrar" : "Criar conta"}
      </button>
      <button
        type="button"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setErr(null);
        }}
        className="text-[10.5px] text-muted hover:text-text"
      >
        {mode === "signin" ? "Não tem conta? Criar conta" : "Já tenho conta"}
      </button>
    </form>
  );
}
