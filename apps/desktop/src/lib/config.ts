// Servidor (Supabase) que este app usa. Cada pessoa usa o próprio projeto, então a URL e a
// chave anon são escolhidas na primeira execução (tela Setup) e ficam no localStorage.
// As constantes de build só existem em `pnpm dev` (vite.config.ts), como atalho de desenvolvimento.

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;

export interface ServerConfig {
  url: string;
  anonKey: string;
}

const KEY = "cooper.server";
const CODE_PREFIX = "cooper1.";

/** https://<ref>.supabase.co, ou Supabase local em http://127.0.0.1 / http://localhost. */
export function validServerUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const hosted = u.protocol === "https:" && /^[a-z0-9-]+\.supabase\.co$/i.test(u.hostname);
  const local = u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
  if (!hosted && !local) return null;
  if (u.pathname !== "/" || u.search || u.hash) return null;
  return u.origin;
}

/** Chave anon (JWT) ou chave publicável nova (sb_publishable_…). Nunca a service_role/secret. */
export function validAnonKey(raw: string): string | null {
  const k = raw.trim();
  if (/^sb_publishable_[\w-]{10,}$/.test(k)) return k;
  const parts = k.split(".");
  if (parts.length !== 3 || !k.startsWith("eyJ")) return null;
  try {
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role === "anon" ? k : null;
  } catch {
    return null;
  }
}

export function loadServerConfig(): ServerConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const c = JSON.parse(raw) as Partial<ServerConfig>;
      const url = validServerUrl(c.url ?? "");
      const anonKey = validAnonKey(c.anonKey ?? "");
      if (url && anonKey) return { url, anonKey };
    }
  } catch {
    // storage indisponível ou corrompido: cai no setup
  }
  if (__SUPABASE_URL__ && __SUPABASE_ANON_KEY__) return { url: __SUPABASE_URL__, anonKey: __SUPABASE_ANON_KEY__ };
  return null;
}

/** Grava e recarrega: o cliente do Supabase é criado uma vez, no início. */
export function saveServerConfig(c: ServerConfig) {
  localStorage.setItem(KEY, JSON.stringify(c));
  location.reload();
}

export function clearServerConfig() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nada a limpar
  }
  location.reload();
}

const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

/** Código que quem convida manda para a outra pessoa: aponta para o mesmo servidor. Só contém dados públicos. */
export function encodeConnectionCode(c: ServerConfig): string {
  return CODE_PREFIX + b64url(JSON.stringify({ url: c.url, anonKey: c.anonKey }));
}

export function decodeConnectionCode(code: string): ServerConfig | null {
  const t = code.trim();
  if (!t.startsWith(CODE_PREFIX)) return null;
  try {
    const c = JSON.parse(fromB64url(t.slice(CODE_PREFIX.length))) as Partial<ServerConfig>;
    const url = validServerUrl(c.url ?? "");
    const anonKey = validAnonKey(c.anonKey ?? "");
    return url && anonKey ? { url, anonKey } : null;
  } catch {
    return null;
  }
}

export const SCHEMA_VERSION = 12;

export type ServerCheck = { ok: true; schema: number } | { ok: false; reason: string };

/** Confere se o servidor responde e tem o SQL de instalação do Cooper (RPC cooper_server_info). */
export async function checkServer(c: ServerConfig): Promise<ServerCheck> {
  let res: Response;
  try {
    res = await fetch(`${c.url}/rest/v1/rpc/cooper_server_info`, {
      method: "POST",
      headers: { apikey: c.anonKey, "Content-Type": "application/json", ...(c.anonKey.startsWith("eyJ") ? { Authorization: `Bearer ${c.anonKey}` } : {}) },
      body: "{}",
    });
  } catch {
    return { ok: false, reason: "Não consegui conectar a esse endereço. Confira a URL e a sua internet." };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "A chave anon não foi aceita por esse servidor." };
  if (res.status === 404) return { ok: false, reason: "SQL de instalação não aplicado: cole o SQL no SQL Editor do projeto e rode." };
  if (!res.ok) return { ok: false, reason: `O servidor respondeu com erro (${res.status}).` };
  const body = (await res.json().catch(() => null)) as { app?: string; schema?: number } | null;
  if (body?.app !== "cooper" || typeof body.schema !== "number") return { ok: false, reason: "Esse projeto não parece ser um servidor do Cooper." };
  if (body.schema < SCHEMA_VERSION) {
    return { ok: false, reason: `O servidor está na versão ${body.schema} do esquema e o app precisa da ${SCHEMA_VERSION}. Rode o SQL de instalação atualizado.` };
  }
  return { ok: true, schema: body.schema };
}

export const serverHost = (c: ServerConfig | null) => (c ? new URL(c.url).host : "—");
