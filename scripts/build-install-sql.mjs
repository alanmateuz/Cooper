// Gera supabase/install.sql: todas as migrações em ordem, num arquivo só, para colar no
// SQL Editor de um projeto Supabase novo (setup com servidor próprio).
//
// Diferença em relação a rodar as migrações uma a uma: o SQL Editor executa tudo numa
// transação, e um valor novo de enum não pode ser usado na mesma transação em que foi
// criado. Por isso o enum task_status já nasce com todos os valores e as linhas
// `alter type public.task_status add value` saem.
//
// Uso: node scripts/build-install-sql.mjs [--check]   (--check falha se o arquivo estiver desatualizado)
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = join(root, "supabase", "migrations");
const out = join(root, "supabase", "install.sql");

const ENUM_ORIGINAL = "create type public.task_status as enum ('backlog', 'in_progress', 'in_review', 'done');";
const ENUM_FULL = "create type public.task_status as enum ('awaiting_acceptance', 'backlog', 'in_progress', 'in_review', 'done', 'declined');";
const ADD_VALUE = /^alter type public\.task_status add value[^;]*;\s*$/gm;

export function buildInstallSql() {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const parts = files.map((f) => {
    let sql = readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n");
    if (sql.includes(ENUM_ORIGINAL)) sql = sql.replace(ENUM_ORIGINAL, ENUM_FULL);
    sql = sql.replace(ADD_VALUE, "-- (valor já incluído na criação do enum)\n");
    return `-- ═════════════ ${f} ═════════════\n${sql.trimEnd()}\n`;
  });
  if (!parts[0]?.includes(ENUM_FULL)) throw new Error("não encontrei a criação do enum task_status na primeira migração");
  const header = [
    "-- Cooper — SQL de instalação (gerado por scripts/build-install-sql.mjs; não edite à mão).",
    "-- Cole tudo no SQL Editor de um projeto Supabase NOVO e clique em Run.",
    `-- Contém ${files.length} migrações: ${files[0]} … ${files.at(-1)}.`,
    "",
  ].join("\n");
  return `${header}\n${parts.join("\n")}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sql = buildInstallSql();
  if (process.argv.includes("--check")) {
    const current = existsSync(out) ? readFileSync(out, "utf8").replace(/\r\n/g, "\n") : "";
    if (current !== sql) {
      console.error("supabase/install.sql está desatualizado: rode `pnpm db:install-sql`.");
      process.exit(1);
    }
    console.log("supabase/install.sql em dia.");
  } else {
    writeFileSync(out, sql);
    console.log(`supabase/install.sql gerado (${(sql.length / 1024).toFixed(0)} KB).`);
  }
}
