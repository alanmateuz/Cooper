import { createClient } from "@supabase/supabase-js";
import { loadServerConfig } from "./config";

/** Servidor escolhido na tela Setup (ou o de dev). Null = mostrar o Setup. */
export const serverConfig = loadServerConfig();
export const isConfigured = serverConfig !== null;

// A sessão fica no localStorage do webview.
// TODO: mover o refresh token para o chaveiro do SO (crate keyring).
export const supabase = createClient(serverConfig?.url ?? "http://invalid.local", serverConfig?.anonKey ?? "missing", {
  auth: { persistSession: true, autoRefreshToken: true },
});
