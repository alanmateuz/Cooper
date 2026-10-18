// Aplica as migrações em supabase/migrations no projeto hospedado.
// Lê SUPABASE_DB_URL do .env sem nunca imprimir o valor.
import { spawnSync } from "node:child_process";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env");
} catch {
  console.error("Arquivo .env não encontrado. Copie .env.example para .env e preencha.");
  process.exit(1);
}

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("SUPABASE_DB_URL vazio no .env.");
  process.exit(1);
}

const args = ["exec", "supabase", "db", "push", "--db-url", dbUrl, ...process.argv.slice(2)];
const r = spawnSync("pnpm", args, { stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status ?? 1);
