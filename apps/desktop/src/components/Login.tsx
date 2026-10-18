import { useState } from "react";
import { supabase } from "../lib/supabase";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="flex h-full flex-col justify-center gap-2 p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        setBusy(false);
        if (error) setErr(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : error.message);
      }}
    >
      <h1 className="text-[15px] font-semibold">Cooper</h1>
      <p className="mb-2 text-muted">Entre para ver o seu time.</p>
      <input
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="e-mail"
        className="rounded-md border border-line bg-raised px-2 py-1.5 outline-none focus:border-accent"
      />
      <input
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="senha"
        className="rounded-md border border-line bg-raised px-2 py-1.5 outline-none focus:border-accent"
      />
      {err && <p className="text-[10.5px] text-red-400">{err}</p>}
      <button disabled={busy} className="mt-1 rounded-md bg-accent py-1.5 font-medium text-white disabled:opacity-50">
        {busy ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
