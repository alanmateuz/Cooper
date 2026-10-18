// cooper-mcp config <claude-code|codex> [--write]
// Mostra o que será configurado no cliente. Só altera a configuração do usuário com --write.
// O token vem de COOPER_TOKEN (nunca da linha de comando, para não ficar no histórico do shell).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Valores PÚBLICOS (URL e chave anon) podem vir do .env da raiz do repositório.
// Nada secreto é lido daqui.
function publicEnv(key: "SUPABASE_URL" | "SUPABASE_ANON_KEY"): string {
  const file = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env");
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : "";
}

const [client, ...flags] = process.argv.slice(2);
const write = flags.includes("--write");
if (client !== "claude-code" && client !== "codex") {
  console.error("uso: cooper-mcp config <claude-code|codex> [--write]");
  process.exit(1);
}

const serverPath = join(dirname(fileURLToPath(import.meta.url)), "index.js").replaceAll("\\", "/");
const token = process.env.COOPER_TOKEN ?? "";
const url = process.env.COOPER_SUPABASE_URL || publicEnv("SUPABASE_URL");
const anon = process.env.COOPER_SUPABASE_ANON_KEY || publicEnv("SUPABASE_ANON_KEY");

const envPairs = (t: string) => [`COOPER_TOKEN=${t}`, `COOPER_SUPABASE_URL=${url}`, `COOPER_SUPABASE_ANON_KEY=${anon}`];
const mask = (t: string) => (t ? `${t.slice(0, 9)}…` : "<COOPER_TOKEN>");

// Escopo de usuário + filtro natural por workspace (o token): nada é escrito dentro dos repositórios.
const argsFor = (t: string) =>
  client === "claude-code"
    ? ["mcp", "add", "--scope", "user", ...envPairs(t).flatMap((p) => ["--env", p]), "--transport", "stdio", "cooper", "--", "node", serverPath]
    : ["mcp", "add", "cooper", ...envPairs(t).flatMap((p) => ["--env", p]), "--", "node", serverPath];
const bin = client === "claude-code" ? "claude" : "codex";

console.log(`Cliente: ${client}`);
console.log(`Onde grava: ${client === "claude-code" ? "~/.claude.json (escopo user)" : "~/.codex/config.toml"}`);
console.log(`Comando:\n  ${bin} ${argsFor(mask(token)).map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}\n`);

if (!write) {
  console.log("Nada foi alterado. Rode de novo com --write (e COOPER_TOKEN definido) para aplicar.");
  process.exit(0);
}
if (!token || !url || !anon) {
  console.error("Defina COOPER_TOKEN (gerado no widget: Configurações → Agentes) antes de --write. URL e chave anon vêm do .env da raiz.");
  process.exit(1);
}
const r = spawnSync(bin, argsFor(token), { stdio: "inherit", shell: false });
if (r.error) {
  console.error(`Não consegui executar '${bin}': ${r.error.message}`);
  process.exit(1);
}
process.exit(r.status ?? 1);
