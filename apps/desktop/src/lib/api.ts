// Mutações do widget num lugar só. Toda função devolve `null` em caso de sucesso ou a mensagem de erro
// já traduzida (friendlyError), para o componente só mostrar. As regras de verdade ficam no banco (RLS e triggers).
import type { ContextWriteResult, Task } from "@cooper/shared";
import { friendlyError } from "./errors";
import { supabase } from "./supabase";

type Result = Promise<string | null>;
const done = (error: unknown) => (error ? friendlyError(error) : null);

// ───── tarefas ─────
export type TaskEdit = Partial<Pick<Task, "title" | "prompt" | "description" | "acceptance_criteria">>;

export async function createTask(fields: Partial<Task> & { workspace_id: string; title: string }, me: string): Result {
  const { error } = await supabase.from("tasks").insert({ ...fields, created_by: me });
  return done(error);
}

/** Status, responsável, aceite/recusa e edição de texto: o banco decide o que cada um pode mudar. */
export async function updateTask(id: string, fields: Partial<Task>): Result {
  const { error } = await supabase.from("tasks").update(fields).eq("id", id);
  return done(error);
}

export async function deleteTask(id: string): Result {
  const { data, error } = await supabase.from("tasks").delete().eq("id", id).select("id");
  if (error) return friendlyError(error);
  return data?.length ? null : "Você não pode excluir esta tarefa.";
}

// ───── projeto ─────
export async function createWorkspace(name: string, me: string): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase.from("workspaces").insert({ name: name.trim(), created_by: me }).select("id").single();
  return error ? { error: friendlyError(error) } : { id: data.id };
}

export async function renameWorkspace(id: string, name: string): Result {
  const { data, error } = await supabase.from("workspaces").update({ name: name.trim() }).eq("id", id).select("id");
  if (error) return friendlyError(error);
  return data?.length ? null : "Só o dono do projeto pode renomear.";
}

export async function deleteWorkspace(id: string): Result {
  const { data, error } = await supabase.from("workspaces").delete().eq("id", id).select("id");
  if (error) return friendlyError(error);
  return data?.length ? null : "Só o dono do projeto pode apagar.";
}

/** Sair (membro) ou remover alguém (dono): o banco revoga os tokens e apaga o uso compartilhado da pessoa. */
export async function removeMember(workspaceId: string, userId: string): Result {
  const { data, error } = await supabase.from("workspace_members").delete().eq("workspace_id", workspaceId).eq("user_id", userId).select("user_id");
  if (error) return friendlyError(error);
  return data?.length ? null : "Não foi possível remover (o dono não sai do próprio projeto; apague-o).";
}

// ───── convites ─────
export async function inviteMember(workspaceId: string, email: string, me: string): Result {
  const { error } = await supabase.from("workspace_invites").insert({ workspace_id: workspaceId, email: email.trim().toLowerCase(), invited_by: me });
  if (error?.code === "23505") return "Esse e-mail já foi convidado.";
  return done(error);
}

export async function cancelInvite(id: string): Result {
  const { error } = await supabase.from("workspace_invites").delete().eq("id", id);
  return done(error);
}

export async function acceptInvite(id: string): Promise<{ workspaceId: string } | { error: string }> {
  const { data, error } = await supabase.rpc("accept_invite", { p_invite: id });
  return error ? { error: friendlyError(error) } : { workspaceId: data as string };
}

// ───── perfil ─────
export async function updateProfile(me: string, fields: { display_name?: string; avatar_color?: string }): Result {
  const { error } = await supabase.from("profiles").update(fields).eq("id", me);
  return done(error);
}

// ───── agentes ─────
export async function revokeAgentConnection(id: string): Result {
  const { data, error } = await supabase.from("agent_connections").update({ revoked_at: new Date().toISOString() }).eq("id", id).select("id");
  if (error) return friendlyError(error);
  return data?.length ? null : "Não foi possível revogar este token.";
}

// ───── contexto ─────
// Conflito de versão não é erro: volta como dado ({ ok: false, conflict, current }) para o editor mesclar.
// Erros de verdade lançam; o componente traduz com friendlyError.

async function ctx(fn: string, args: Record<string, unknown>): Promise<ContextWriteResult> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as ContextWriteResult;
}

export const contextApi = {
  create: (workspaceId: string, title: string, content: string) => ctx("context_create", { p_workspace: workspaceId, p_title: title, p_content: content }),
  update: (blockId: string, title: string | null, content: string, baseVersion: number) =>
    ctx("context_update", { p_block: blockId, p_title: title, p_content: content, p_base_version: baseVersion }),
  remove: (blockId: string, baseVersion: number) => ctx("context_delete", { p_block: blockId, p_base_version: baseVersion }),
  restore: (blockId: string, version: number, baseVersion: number) => ctx("context_restore", { p_block: blockId, p_version: version, p_base_version: baseVersion }),
};

// ───── agentes e uso ─────
export async function createAgentToken(workspaceId: string, kind: string): Promise<{ id: string; token: string } | { error: string }> {
  const { data, error } = await supabase.rpc("create_agent_token", { p_workspace: workspaceId, p_kind: kind, p_label: "widget" });
  return error ? { error: friendlyError(error) } : (data as { id: string; token: string });
}

/** Depois de conectar um agente com um token novo, os tokens antigos do mesmo agente deixam de valer. */
export async function revokeOtherConnections(workspaceId: string, me: string, kind: string, keepId: string): Result {
  const { error } = await supabase
    .from("agent_connections")
    .update({ revoked_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("user_id", me)
    .eq("agent_kind", kind)
    .neq("id", keepId)
    .is("revoked_at", null);
  return done(error);
}

export async function setUsageSharing(workspaceId: string, on: boolean): Result {
  const { error } = await supabase.rpc("set_usage_sharing", { p_workspace: workspaceId, p_on: on });
  return done(error);
}
