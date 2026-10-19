// Postgres em memória (PGlite) com o mínimo do Supabase que as migrações usam:
// auth.users, auth.uid(), auth.jwt(), papéis anon/authenticated, pgcrypto em `extensions`
// e a publicação supabase_realtime. Serve para testar triggers, RLS e RPCs sem tocar em
// nenhum projeto online (roda em `pnpm test` e no CI).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema extensions;
create extension pgcrypto schema extensions;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant usage on schema auth, extensions, public to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create publication supabase_realtime;
`;

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Banco novo com o stub do Supabase e as migrações (cada arquivo numa transação, como o `supabase db push`). */
export async function freshDb(opts: { sql?: string } = {}): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  if (opts.sql !== undefined) {
    await db.exec(opts.sql);
  } else {
    for (const f of migrationFiles()) {
      try {
        await db.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
      } catch (e) {
        throw new Error(`${f}: ${(e as Error).message}`);
      }
    }
  }
  return db;
}

export async function createUser(db: PGlite, email: string, name: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('display_name', $2::text)) returning id",
    [email, name],
  );
  return r.rows[0]!.id;
}

type Tx = Transaction;

/** Roda `fn` como uma pessoa logada (papel authenticated, JWT com sub e e-mail). Desfaz se der erro. */
export async function asUser<T>(db: PGlite, user: { id: string; email: string }, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user.id, email: user.email, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    return fn(tx);
  });
}

/** Roda `fn` como o servidor MCP (papel anon, sem JWT): só as RPCs mcp_* funcionam. */
export async function asAgent<T>(db: PGlite, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', '', true)");
    await tx.exec("set local role anon");
    return fn(tx);
  });
}

/** Cria um token de agente direto no banco (como o seed) e devolve o texto. */
export async function agentToken(db: PGlite, ws: string, user: string, kind = "codex"): Promise<string> {
  const token = "coop_" + Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
  await db.query(
    "insert into public.agent_connections (workspace_id, user_id, agent_kind, token_hash, token_prefix) values ($1, $2, $3, encode(extensions.digest($4, 'sha256'), 'hex'), left($4, 9))",
    [ws, user, kind, token],
  );
  return token;
}

export const one = async <T>(p: Promise<{ rows: T[] }>): Promise<T> => (await p).rows[0]!;
