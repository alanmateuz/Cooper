import type { WorkspaceData } from "./useWorkspace";

/** "Alan Mateus (teste)" → "Alan Mateus": tira a observação entre parênteses. */
export const shortName = (displayName: string) => displayName.replace(/\s*\(.*\)/, "").trim() || displayName;

/** "Alan Mateus (teste)" → "Alan". */
export const firstName = (displayName: string) => shortName(displayName).split(/\s+/)[0] ?? displayName;

const profileOf = (d: WorkspaceData, id: string | null) => d.members.find((m) => m.user_id === id)?.profile ?? null;

/** Nome curto de um membro do workspace; `fallback` quando não há (sem responsável, membro que saiu). */
export function memberName(d: WorkspaceData, id: string | null, fallback = "—"): string {
  const p = profileOf(d, id);
  return p ? shortName(p.display_name) : fallback;
}

export function memberFirstName(d: WorkspaceData, id: string | null, fallback = "Alguém"): string {
  const p = profileOf(d, id);
  return p ? firstName(p.display_name) : fallback;
}
