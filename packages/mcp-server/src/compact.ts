// Respostas mais curtas para o agente: cada caractere entra no contexto da conversa.
// - tira null, "" e [] (recursivamente; false e 0 ficam, porque carregam informação);
// - datas ISO viram tempo relativo ("há 5 min", "em 2 h"), mais curto e mais útil para o modelo.

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

export function relativeTime(iso: string, now: Date): string {
  const diffMin = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000);
  const abs = Math.abs(diffMin);
  if (abs < 1) return "agora";
  const span = abs < 60 ? `${abs} min` : abs < 48 * 60 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} d`;
  return diffMin < 0 ? `há ${span}` : `em ${span}`;
}

export function compact(value: unknown, now: Date = new Date()): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => compact(v, now)).filter((v) => !isEmpty(v));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const c = compact(v, now);
      if (!isEmpty(c)) out[k] = c;
    }
    return out;
  }
  if (typeof value === "string" && ISO.test(value)) return relativeTime(value, now);
  return value;
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
