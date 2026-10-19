/**
 * Alertas sonoros sintetizados (Web Audio), sem arquivo de áudio.
 * O webview só libera som depois de um clique na janela, então o contexto é destravado no primeiro clique.
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => void audio(), { once: true, capture: true });
}

/** [frequência em Hz, início em s] */
const TUNES: Record<"normal" | "critical", [number, number][]> = {
  // duas notas subindo, curtas: "chegou algo"
  normal: [
    [784, 0],
    [1047, 0.11],
  ],
  // quatro notas alternadas, mais graves: "atenção"
  critical: [
    [880, 0],
    [622, 0.16],
    [880, 0.32],
    [622, 0.48],
  ],
};

export function playChime(kind: "normal" | "critical" = "normal") {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + 0.02;
  for (const [freq, start] of TUNES[kind]) {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = kind === "critical" ? "triangle" : "sine";
    osc.frequency.value = freq;
    const t = t0 + start;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(gain).connect(a.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  }
}
