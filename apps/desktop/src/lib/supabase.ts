import { createClient } from "@supabase/supabase-js";

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;

export const SUPABASE_URL = __SUPABASE_URL__;
export const SUPABASE_ANON_KEY = __SUPABASE_ANON_KEY__;
export const isConfigured = Boolean(__SUPABASE_URL__ && __SUPABASE_ANON_KEY__);

// Fase 1: a sessão fica no localStorage do webview.
// TODO(Fase 2): mover o refresh token para o chaveiro do SO (crate keyring).
export const supabase = createClient(__SUPABASE_URL__ || "http://invalid.local", __SUPABASE_ANON_KEY__ || "missing", {
  auth: { persistSession: true, autoRefreshToken: true },
});
