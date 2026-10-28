import { useState } from "react";
import { friendlyError } from "../lib/errors";
import { supabase } from "../lib/supabase";
import { BrandHeader } from "./ui";

const inputCls =
  "w-full rounded-lg border border-line bg-raised px-2.5 py-2 outline-none placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/25 read-only:text-muted";

type Mode = "signin" | "signup" | "forgot" | "reset";

/** Título e explicação de cada passo: a tela diz qual tarefa está sendo feita. */
const STEP: Record<Mode, { title: string; hint: string; action: string }> = {
  signin: { title: "Entrar", hint: "Use a conta com que você foi convidado para o time.", action: "Entrar" },
  signup: { title: "Criar conta", hint: "Use o mesmo e-mail do convite, se você recebeu um.", action: "Criar conta" },
  forgot: { title: "Recuperar senha", hint: "Enviamos um código de 6 dígitos para o seu e-mail.", action: "Enviar código" },
  reset: { title: "Senha nova", hint: "Digite o código que chegou no e-mail e escolha a senha nova.", action: "Trocar senha e entrar" },
};

/** Rótulo sempre visível acima do campo (placeholder não substitui rótulo). */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="flex items-baseline justify-between text-[11px] font-medium">
        {label}
        {hint && <span className="font-normal text-muted">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function Login() {
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [showPw, setShowPw] = useState(false);
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
          setInfo("Conta criada. Abra o link de confirmação que enviamos para o seu e-mail e depois entre aqui. Se a página do link der erro, a conta fica confirmada mesmo assim.");
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

  const step = STEP[mode];
  const newPassword = mode !== "signin";

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 pt-7 pb-5">
      <BrandHeader />

      <form
        className="mt-6 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <h1 className="text-[14px] font-semibold">{step.title}</h1>
          <p className="mt-0.5 text-[11px] leading-snug text-muted">{step.hint}</p>
        </div>

        {info && (
          <p role="status" className="rounded-lg border border-run/40 bg-run/10 px-2.5 py-2 text-[11px] leading-snug">
            {info}
          </p>
        )}

        {mode === "signup" && (
          <Field label="Seu nome">
            <input required maxLength={60} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Como o time vai te ver" className={inputCls} />
          </Field>
        )}
        <Field label="E-mail">
          <input
            type="email"
            autoComplete="username"
            required
            readOnly={mode === "reset"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@exemplo.com"
            className={inputCls}
          />
        </Field>
        {mode === "reset" && (
          <Field label="Código do e-mail" hint="6 dígitos">
            <input
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className={`${inputCls} tracking-[0.35em] tabular-nums`}
            />
          </Field>
        )}
        {mode !== "forgot" && (
          <Field label={mode === "reset" ? "Senha nova" : "Senha"} hint={newPassword ? "mínimo 8 caracteres" : undefined}>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                autoComplete={newPassword ? "new-password" : "current-password"}
                required
                minLength={newPassword ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputCls} pr-14`}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute inset-y-0 right-1.5 my-auto h-6 rounded px-1.5 text-[10.5px] text-muted hover:bg-panel hover:text-text"
                aria-label={showPw ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPw ? "ocultar" : "mostrar"}
              </button>
            </div>
          </Field>
        )}

        {err && (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-2 text-[11px] leading-snug text-danger">
            {err}
          </p>
        )}

        <button disabled={busy} className="w-full rounded-lg bg-accent py-2 font-medium text-white hover:brightness-110 disabled:opacity-60">
          {busy ? "Aguarde…" : step.action}
        </button>

        {mode === "signin" && (
          <button type="button" onClick={() => go("forgot")} className="block w-full text-center text-[11px] text-muted hover:text-text">
            Esqueci a senha
          </button>
        )}
        {mode === "reset" && (
          <button type="button" disabled={busy} onClick={() => go("forgot")} className="block w-full text-center text-[11px] text-muted hover:text-text">
            Não chegou? Reenviar código
          </button>
        )}
      </form>

      <div className="mt-auto pt-5 text-center text-[11px] text-muted">
        {mode === "signin" ? (
          <>
            Ainda não tem conta?{" "}
            <button type="button" onClick={() => go("signup")} className="font-medium text-accent hover:underline">
              Criar conta
            </button>
          </>
        ) : (
          <button type="button" onClick={() => go("signin")} className="font-medium text-accent hover:underline">
            Voltar para entrar
          </button>
        )}
      </div>
    </div>
  );
}
