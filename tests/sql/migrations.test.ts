// Todas as migrações aplicam em sequência num Postgres limpo, e o install.sql (uma transação só,
// como o SQL Editor do Supabase) gera exatamente o mesmo esquema.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
// @ts-expect-error script .mjs sem tipos
import { buildInstallSql } from "../../scripts/build-install-sql.mjs";
import { freshDb, MIGRATIONS_DIR } from "./harness";

/** Assinatura do esquema público: colunas, funções, policies, triggers e valores de enum. */
async function schemaSignature(db: PGlite): Promise<string[]> {
  const q = async (sql: string) => (await db.query<{ s: string }>(sql)).rows.map((r) => r.s);
  return [
    ...(await q(`select table_name || '.' || column_name || ':' || data_type as s from information_schema.columns
                 where table_schema = 'public' order by 1`)),
    ...(await q(`select 'fn ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as s
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`)),
    ...(await q(`select 'policy ' || tablename || '.' || policyname || ' ' || cmd as s from pg_policies where schemaname = 'public' order by 1`)),
    ...(await q(`select 'trigger ' || event_object_table || '.' || trigger_name || ' ' || event_manipulation as s
                 from information_schema.triggers where trigger_schema = 'public' order by 1`)),
    ...(await q(`select 'enum ' || t.typname || ' ' || string_agg(e.enumlabel, ',' order by e.enumsortorder) as s
                 from pg_enum e join pg_type t on t.oid = e.enumtypid group by t.typname order by 1`)),
  ];
}

describe("migrações", () => {
  it("aplicam do zero, em ordem", async () => {
    const db = await freshDb();
    const r = await db.query<{ info: { app: string; schema: number } }>("select public.cooper_server_info() as info");
    expect(r.rows[0]!.info).toEqual({ app: "cooper", schema: 12 });
  });

  it("install.sql está em dia com as migrações", () => {
    const onDisk = readFileSync(join(MIGRATIONS_DIR, "..", "install.sql"), "utf8").replace(/\r\n/g, "\n");
    expect(onDisk, "rode `pnpm db:install-sql`").toBe(buildInstallSql());
  });

  it("install.sql aplica numa transação só e gera o mesmo esquema", async () => {
    const viaMigrations = await schemaSignature(await freshDb());
    const viaInstall = await schemaSignature(await freshDb({ sql: `begin;\n${buildInstallSql()}\ncommit;` }));
    expect(viaInstall).toEqual(viaMigrations);
  });
});
