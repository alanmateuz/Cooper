import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { Login } from "./components/Login";
import { Widget } from "./components/Widget";
import { pref, setPref } from "./lib/format";
import { isConfigured, supabase } from "./lib/supabase";
import { applyWindowMode, dragFromMouseDown, inTauri, WINDOW_SIZES, type WidgetMode } from "./lib/window";

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [mode, setModeState] = useState<WidgetMode>(() => pref<WidgetMode>("mode", "compact"));
  const [theme, setThemeState] = useState<"dark" | "light">(() => pref("theme", "dark"));

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Sem sessão a janela fica no tamanho compacto (formulário de login).
  const effectiveMode: WidgetMode = session ? mode : "compact";
  useEffect(() => {
    void applyWindowMode(effectiveMode);
  }, [effectiveMode]);

  const setMode = (m: WidgetMode) => {
    setModeState(m);
    setPref("mode", m);
  };
  const setTheme = (t: "dark" | "light") => {
    setThemeState(t);
    setPref("theme", t);
  };

  const content = !isConfigured ? (
    <div onMouseDown={dragFromMouseDown} className="flex h-full items-center justify-center rounded-xl border border-line bg-bg p-6 text-center text-muted">
      Configure SUPABASE_URL e SUPABASE_ANON_KEY no .env da raiz e reinicie.
    </div>
  ) : session === undefined ? null : session === null ? (
    // Sem barra de topo no login: a tela toda arrasta (campos e botão não).
    <div onMouseDown={dragFromMouseDown} className="h-full rounded-xl border border-line bg-bg">
      <Login />
    </div>
  ) : (
    <Widget session={session} mode={mode} setMode={setMode} theme={theme} setTheme={setTheme} />
  );

  if (inTauri) return content;

  // No navegador: simula a janela com o tamanho exato de cada modo.
  const size = WINDOW_SIZES[effectiveMode];
  return (
    <div className="flex h-full items-center justify-center bg-[#2a2d35] light:bg-[#c9ccd3]">
      <div style={{ width: size.width, height: size.height }} data-mode={effectiveMode}>
        {content}
      </div>
    </div>
  );
}
