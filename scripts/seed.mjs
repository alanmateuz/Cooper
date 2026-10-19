// Dados de exemplo: dois usuários de teste num workspace e um terceiro isolado
// em outro workspace (usado pelos testes de RLS).
// Idempotente: recria os workspaces de teste a cada execução.
// As senhas geradas vão para .env.local (ignorado pelo git) e não são impressas.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Preencha SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.");
  process.exit(1);
}
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ── senhas de teste em .env.local ──
const LOCAL = ".env.local";
const local = existsSync(LOCAL)
  ? Object.fromEntries(
      readFileSync(LOCAL, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    )
  : {};

const USERS = [
  { key: "ALAN", email: "alan.teste@example.com", name: "Alan (teste)", color: "#6366f1" },
  { key: "BIA", email: "bia.teste@example.com", name: "Bia (teste)", color: "#14b8a6" },
  { key: "INTRUSO", email: "intruso.teste@example.com", name: "Intruso (teste)", color: "#f97316" },
];

async function must(p) {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

async function ensureUser(u) {
  const pwKey = `TEST_${u.key}_PASSWORD`;
  local[`TEST_${u.key}_EMAIL`] = u.email;
  local[pwKey] ||= randomBytes(18).toString("base64url");

  const { users } = await must(admin.auth.admin.listUsers({ perPage: 1000 }));
  const found = users.find((x) => x.email === u.email);
  const user = found
    ? (await must(admin.auth.admin.updateUserById(found.id, { password: local[pwKey] }))).user
    : (
        await must(
          admin.auth.admin.createUser({
            email: u.email,
            password: local[pwKey],
            email_confirm: true,
            user_metadata: { display_name: u.name },
          }),
        )
      ).user;
  await must(admin.from("profiles").update({ display_name: u.name, avatar_color: u.color }).eq("id", user.id));
  return user.id;
}

const ids = {};
for (const u of USERS) ids[u.key] = await ensureUser(u);

// ── workspaces de teste: apaga e recria ──
await must(admin.from("workspaces").delete().in("created_by", Object.values(ids)));

const ws = await must(
  admin.from("workspaces").insert({ name: "Hacko (demo)", created_by: ids.ALAN }).select().single(),
);
await must(admin.from("workspace_members").insert({ workspace_id: ws.id, user_id: ids.BIA, role: "member" }));

const other = await must(
  admin.from("workspaces").insert({ name: "Outro (isolamento)", created_by: ids.INTRUSO }).select().single(),
);
await must(admin.from("tasks").insert({ workspace_id: other.id, title: "Tarefa secreta de outro time", created_by: ids.INTRUSO }));

const repo = await must(
  admin
    .from("repositories")
    .insert({ workspace_id: ws.id, owner: "alanmateuz", name: "hacko-platform", default_branch: "main" })
    .select()
    .single(),
);

const taskRows = [
  { title: "Implementar QR Codes de inscrição", status: "in_progress", assignee_id: ids.ALAN,
    acceptance_criteria: "Gerar QR por inscrição; validar no check-in; QR expirado é recusado." },
  { title: "Tela de times do evento", status: "in_progress", assignee_id: ids.BIA },
  { title: "Notificações por e-mail de entrega", status: "backlog" },
  { title: "Ajustar layout da landing", status: "in_review", assignee_id: ids.BIA },
  { title: "Login com link mágico", status: "done", assignee_id: ids.ALAN },
  // convite de tarefa: Alan envia para a Bia, com prompt (nasce aguardando aceite)
  { title: "Header da página do evento", assignee_id: ids.BIA, created_by: ids.ALAN,
    prompt: "Crie o header da página do evento: logo à esquerda, menu (Programação, Times, Entregas) à direita, responsivo." },
];
const tasks = [];
for (const t of taskRows) {
  // cada um cria as próprias tarefas (já aceitas); só a do convite tem created_by explícito
  const created_by = t.created_by ?? t.assignee_id ?? ids.ALAN;
  tasks.push(await must(admin.from("tasks").insert({ ...t, workspace_id: ws.id, created_by }).select().single()));
}
const [qr, times] = tasks;

await must(
  admin.from("context_blocks").insert([
    { workspace_id: ws.id, position: 0, title: "Resumo", updated_by: ids.ALAN,
      content: "Hacko: plataforma de hackathons com inscrição, times, entregas e avaliação." },
    { workspace_id: ws.id, position: 1, title: "Arquitetura", updated_by: ids.ALAN,
      content: "React + Vinext em Cloudflare Workers, D1 (SQLite) com Drizzle, R2 para arquivos, Resend para e-mail." },
    { workspace_id: ws.id, position: 2, title: "Convenções", updated_by: ids.ALAN,
      content: "Branches claude/<tema> ou codex/<tema>; mencionar #N da tarefa no commit." },
  ]),
);

// Sessões e eventos de exemplo (marcados com seed no client_session_id).
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const sAlan = await must(
  admin.from("agent_sessions").insert({
    workspace_id: ws.id, user_id: ids.ALAN, agent_kind: "codex", client_session_id: "seed-alan",
    has_hooks: true, current_task_id: qr.id, activity_text: "Criando geração e validação de QR Codes",
    started_at: iso(40 * 60_000), last_event_at: iso(60_000), last_event_type: "post_tool_use",
  }).select().single(),
);
const sBia = await must(
  admin.from("agent_sessions").insert({
    workspace_id: ws.id, user_id: ids.BIA, agent_kind: "claude_code", client_session_id: "seed-bia",
    has_hooks: false, current_task_id: times.id, activity_text: "Montando lista de membros do time",
    started_at: iso(90 * 60_000), last_event_at: iso(12 * 60_000), last_event_type: "report_progress",
  }).select().single(),
);

await must(
  admin.from("git_snapshots").insert([
    { workspace_id: ws.id, user_id: ids.ALAN, repository_id: repo.id, branch: "codex/qrcode-inscricao",
      head_sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", ahead: 2, behind: 0, dirty_files_count: 3,
      dirty_files: ["app/inscricao/qr.ts", "lib/qr/validate.ts", "tests/qr.test.ts"], observed_at: iso(30_000) },
    { workspace_id: ws.id, user_id: ids.BIA, repository_id: repo.id, branch: "claude/hacko-my-team",
      head_sha: "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432", ahead: 1, behind: 4, dirty_files_count: 1,
      dirty_files: ["components/team/MemberList.tsx"], observed_at: iso(5 * 60_000) },
  ]),
);

await must(
  admin.from("task_events").insert([
    { workspace_id: ws.id, task_id: qr.id, user_id: ids.ALAN, agent_session_id: sAlan.id, source: "agent_declared",
      type: "start_task", occurred_at: iso(40 * 60_000), payload: { branch: "codex/qrcode-inscricao" } },
    { workspace_id: ws.id, task_id: qr.id, user_id: ids.ALAN, agent_session_id: sAlan.id, source: "agent_hook",
      type: "post_tool_use", occurred_at: iso(60_000), payload: { tool_name: "apply_patch" } },
    { workspace_id: ws.id, task_id: qr.id, user_id: ids.ALAN, source: "local_git",
      type: "git_snapshot", occurred_at: iso(30_000), payload: { branch: "codex/qrcode-inscricao", commit: "a1b2c3d" } },
    { workspace_id: ws.id, task_id: times.id, user_id: ids.BIA, agent_session_id: sBia.id, source: "agent_declared",
      type: "report_progress", occurred_at: iso(12 * 60_000), payload: { text: "Montando lista de membros do time" } },
    { workspace_id: ws.id, task_id: tasks[4].id, user_id: ids.ALAN, source: "user",
      type: "status_changed", occurred_at: iso(3 * 3600_000), payload: { from_status: "in_review", to_status: "done" } },
  ]),
);

await must(admin.from("task_links").insert({ workspace_id: ws.id, task_id: qr.id, kind: "branch", ref: "codex/qrcode-inscricao", source: "user" }));

// Tokens de agente de teste (Fase 2). Mantém o mesmo token entre execuções; só o hash vai ao banco.
const AGENTS = [
  { key: "ALAN", kind: "codex", workspace: ws.id },
  { key: "BIA", kind: "claude_code", workspace: ws.id },
  { key: "INTRUSO", kind: "codex", workspace: other.id },
];
for (const a of AGENTS) {
  const envKey = `TEST_${a.key}_AGENT_TOKEN`;
  local[envKey] ||= `coop_${randomBytes(24).toString("hex")}`;
  await must(
    admin.from("agent_connections").insert({
      workspace_id: a.workspace,
      user_id: ids[a.key],
      agent_kind: a.kind,
      label: "teste (seed)",
      token_hash: createHash("sha256").update(local[envKey]).digest("hex"),
      token_prefix: local[envKey].slice(0, 9),
    }),
  );
}

writeFileSync(
  LOCAL,
  "# Gerado por scripts/seed.mjs — credenciais de TESTE, não versionar\n" +
    Object.entries(local).map(([k, v]) => `${k}=${v}`).join("\n") + "\n",
);

console.log(`Seed ok: workspace "${ws.name}" com ${tasks.length} tarefas; usuários de teste: ${USERS.map((u) => u.email).join(", ")}.`);
console.log("Senhas em .env.local.");
