export function timeAgo(iso: string | null, now: Date): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 45) return "agora";
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

export const shortSha = (sha: string | null) => (sha ? sha.slice(0, 7) : null);

export function initials(name: string): string {
  return name
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** Preferências locais (por máquina). Leitura/escrita tolerante a falhas. */
export function pref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`cooper.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
export function setPref(key: string, value: unknown) {
  try {
    localStorage.setItem(`cooper.${key}`, JSON.stringify(value));
  } catch {
    // sem storage: preferência vale só nesta execução
  }
}
