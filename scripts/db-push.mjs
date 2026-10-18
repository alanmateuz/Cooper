// Aplica as migrações em supabase/migrations no projeto hospedado.
// Lê SUPABASE_DB_URL do .env sem nunca imprimir o valor.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Leitura crua da linha: o parser padrão de .env trata "#" como comentário
// e cortaria senhas que contêm esse caractere.
function readRawEnv(key) {
  if (!existsSync(".env")) return null;
  const line = readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${key}=`));
  if (!line) return null;
  let v = line.slice(key.length + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v || null;
}

// Senhas com @ # & / : quebram a URL; codifica a senha (tudo entre o
// primeiro ":" depois do usuário e o ÚLTIMO "@").
function encodePassword(url) {
  const m = url.match(/^(postgres(?:ql)?:\/\/[^:/@]+):(.*)@([^@]+)$/);
  if (!m) return url;
  const [, head, pw, tail] = m;
  let plain = pw;
  try {
    plain = decodeURIComponent(pw); // já codificada: não codificar duas vezes
  } catch {
    // contém % solto: tratar como texto puro
  }
  return `${head}:${encodeURIComponent(plain)}@${tail}`;
}

// Executável do Supabase CLI instalado pelo pnpm, chamado sem shell
// (no Windows o cmd.exe interpretaria & e % da URL).
function supabaseBin() {
  const store = join("node_modules", ".pnpm");
  const os = { win32: "windows", darwin: "darwin", linux: "linux" }[process.platform];
  const dir = readdirSync(store).find((d) => d.startsWith(`@supabase+cli-${os}-${process.arch}@`));
  if (!dir) throw new Error("Supabase CLI não encontrado; rode pnpm install");
  return join(store, dir, "node_modules", "@supabase", `cli-${os}-${process.arch}`, "bin", process.platform === "win32" ? "supabase.exe" : "supabase");
}

const rawUrl = readRawEnv("SUPABASE_DB_URL");
if (!rawUrl) {
  console.error("SUPABASE_DB_URL vazio ou .env ausente. Copie .env.example para .env e preencha.");
  process.exit(1);
}

const args = ["db", "push", "--db-url", encodePassword(rawUrl), ...process.argv.slice(2)];
const r = spawnSync(supabaseBin(), args, { stdio: "inherit" });
process.exit(r.status ?? 1);
