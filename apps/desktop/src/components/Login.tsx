import { useState } from "react";
import { friendlyError } from "../lib/errors";
import { supabase } from "../lib/supabase";

const inputCls = "rounded-md border border-line bg-raised px-2 py-1.5 outline-none focus:border-accent";

type Mode = "signin" | "signup" | "forgot" | "reset";

const SUBTITLE: Record<Mode, string> = {
  signin: "Entre para ver o seu time.",
  signup: "Crie sua conta.",
  forgot: "Digite seu e-mail para receber um código de 6 dígitos.",
  reset: "Digite o código que chegou e a senha nova.",
};

export function Login() {
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = (m: Mode) => {
    setMode(m);
    setErr(null);
    setInfo(null);
  };

  async function submit() {
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setErr(friendlyError(error));
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: name.trim() } } });
        if (error) setErr(friendlyError(error));
        // com "Confirm email" ligado (recomendado), não há sessão até clicar no link
        else if (!data.session) {
          setInfo("Enviamos um link de confirmação para o seu e-mail. Clique nele e depois entre aqui. Se a página do link der erro, a conta fica confirmada mesmo assim.");
          setMode("signin");
        }
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) setErr(friendlyError(error));
        else {
          setPassword("");
          setMode("reset");
        }
      } else {
        const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: "recovery" });
        if (error) return setErr(friendlyError(error));
        // verifyOtp já abre a sessão; trocar a senha agora vale para os próximos logins
        const { error: upd } = await supabase.auth.updateUser({ password });
        if (upd) setErr(friendlyError(upd));
      }
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const label: Record<Mode, string> = { signin: "Entrar", signup: "Criar conta", forgot: "Enviar código", reset: "Trocar senha e entrar" };

  return (
    <form
      className="flex h-full flex-col justify-center gap-2 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h1 className="text-[15px] font-semibold">Cooper</h1>
      <p className="mb-2 text-muted">{SUBTITLE[mode]}</p>
      {mode === "signup" && <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="seu nome" className={inputCls} />}
      <input
        type="email"
        autoComplete="username"
        required
        readOnly={mode === "reset"}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="e-mail"
        className={`${inputCls} ${mode === "reset" ? "text-muted" : ""}`}
      />
      {mode === "reset" && (
        <input
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="código de 6 dígitos"
          aria-label="Código de 6 dígitos"
          className={`${inputCls} tracking-[0.3em] tabular-nums`}
        />
      )}
      {mode !== "forgot" && (
        <input
          type="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          required
          minLength={mode === "signin" ? undefined : 8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "signin" ? "senha" : mode === "reset" ? "senha nova (mín. 8)" : "senha (mín. 8)"}
          className={inputCls}
        />
      )}
      {err && <p className="text-[10.5px] leading-snug text-danger">{err}</p>}
      {info && <p className="text-[10.5px] leading-snug text-run">{info}</p>}
      <button disabled={busy} className="mt-1 rounded-md bg-accent py-1.5 font-medium text-white disabled:opacity-50">
        {busy ? "Aguarde…" : label[mode]}
      </button>
      <div className="flex justify-between text-[10.5px]">
        {mode === "signin" ? (
          <>
            <button type="button" onClick={() => go("signup")} className="text-muted hover:text-text">
              Criar conta
            </button>
            <button type="button" onClick={() => go("forgot")} className="text-muted hover:text-text">
              Esqueci a senha
            </button>
          </>
        ) : (
          <button type="button" onClick={() => go("signin")} className="text-muted hover:text-text">
            Voltar para entrar
          </button>
        )}
        {mode === "reset" && (
          <button type="button" disabled={busy} onClick={() => go("forgot")} className="text-muted hover:text-text">
            Reenviar código
          </button>
        )}
      </div>
    </form>
  );
}
