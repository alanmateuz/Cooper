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

// ───────────── sons de interface (ações secundárias) ─────────────
// Bem mais baixos e curtos que os alertas. Um botão pede som com o atributo data-sound:
//   data-sound="toggle"  chave ligada/desligada        data-sound="ok"  aceitar, salvar, criar, concluir
//   data-sound="remove"  apagar, recusar, desfazer
// Desligável em Ajustes → Notificações → Sons da interface.

export type UiSound = "toggle" | "ok" | "remove";
const UI_TUNES: Record<UiSound, { notes: [number, number][]; gain: number; len: number; type: OscillatorType }> = {
  toggle: { notes: [[1320, 0]], gain: 0.035, len: 0.05, type: "sine" },
  ok: { notes: [[988, 0], [1319, 0.06]], gain: 0.05, len: 0.12, type: "sine" },
  remove: { notes: [[523, 0], [392, 0.06]], gain: 0.05, len: 0.12, type: "triangle" },
};

let uiSoundsOn = (() => {
  try {
    return JSON.parse(localStorage.getItem("cooper.uiSounds") ?? "true") as boolean;
  } catch {
    return true;
  }
})();

export const uiSoundsEnabled = () => uiSoundsOn;
export function setUiSounds(on: boolean) {
  uiSoundsOn = on;
  try {
    localStorage.setItem("cooper.uiSounds", JSON.stringify(on));
  } catch {
    // sem storage: vale só nesta execução
  }
}

export function playUi(kind: UiSound) {
  if (!uiSoundsOn) return;
  const a = audio();
  if (!a) return;
  const { notes, gain: g, len, type } = UI_TUNES[kind];
  const t0 = a.currentTime + 0.01;
  for (const [freq, start] of notes) {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t = t0 + start;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(g, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(gain).connect(a.destination);
    osc.start(t);
    osc.stop(t + len + 0.02);
  }
}

// Sem data-sound, o som vem do papel do botão: chave → toggle; verbo de confirmação → ok; de remoção → remove.
// Navegação, abas e "ver/fechar" ficam em silêncio.
const OK_VERBS = /^(aceitar|salvar|criar|concluir|restaurar|confirmar|enviar|convidar|reenviar|trocar|conectar|gravar|colar|atualizar|instalar)/i;
const REMOVE_VERBS = /^(recusar|apagar|excluir|remover|revogar|desfazer|sair do projeto|cancelar convite)/i;
function soundFor(el: HTMLElement): UiSound | null {
  const explicit = el.dataset.sound;
  if (explicit) return explicit in UI_TUNES ? (explicit as UiSound) : null;
  if (el.getAttribute("role") === "switch") return "toggle";
  const text = (el.textContent ?? "").trim().replace(/^[↻+\s]+/, "");
  if (OK_VERBS.test(text)) return "ok";
  if (REMOVE_VERBS.test(text)) return "remove";
  return null;
}

if (typeof window !== "undefined") {
  window.addEventListener(
    "click",
    (e) => {
      const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>("button, [role=switch], [data-sound]");
      if (!btn || (btn as HTMLButtonElement).disabled) return;
      const kind = soundFor(btn);
      if (kind) playUi(kind);
    },
    { capture: true },
  );
}
