import { authorLabel, type AgentKind } from "@cooper/shared";
import { memberName } from "../../lib/names";
import type { WorkspaceData } from "../../lib/useWorkspace";

/** "Bia", "Codex de Bia" ou "contexto inicial" (sem autor). */
export const who = (d: WorkspaceData, id: string | null, agent: AgentKind | null) => (id ? authorLabel(memberName(d, id, "alguém"), agent) : "contexto inicial");

export const VERB: Record<string, string> = { create: "criou", update: "atualizou", restore: "restaurou", delete: "apagou" };

export const FIELD = "block w-full rounded-md border border-line bg-raised px-2 py-1 leading-snug outline-none focus:border-accent";
