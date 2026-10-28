import { isTauri } from "@tauri-apps/api/core";
import type { MouseEvent as ReactMouseEvent } from "react";

export type WidgetMode = "pill" | "compact" | "expanded";

export const WINDOW_SIZES: Record<WidgetMode, { width: number; height: number }> = {
  pill: { width: 340, height: 44 },
  compact: { width: 360, height: 520 },
  expanded: { width: 360, height: 520 },
};
/** Limites do painel redimensionável (a pílula tem tamanho fixo). */
export const PANEL_MIN = { width: 320, height: 360 };
export const PANEL_MAX = { width: 1600, height: 1200 };
const PANEL_PREF = "cooper.panelSize";

export const inTauri = isTauri();

/** Tamanho que a pessoa deixou o painel da última vez (por máquina). */
export function panelSize(): { width: number; height: number } {
  try {
    const v = JSON.parse(localStorage.getItem(PANEL_PREF) ?? "null") as { width: number; height: number } | null;
    if (v && v.width >= PANEL_MIN.width && v.height >= PANEL_MIN.height) {
      return { width: Math.min(v.width, PANEL_MAX.width), height: Math.min(v.height, PANEL_MAX.height) };
    }
  } catch {
    // sem storage: tamanho padrão
  }
  return WINDOW_SIZES.compact;
}

export function savePanelSize(size: { width: number; height: number }) {
  try {
    localStorage.setItem(PANEL_PREF, JSON.stringify({ width: Math.round(size.width), height: Math.round(size.height) }));
  } catch {
    // sem storage: vale só nesta execução
  }
}

/** Ajusta a janela nativa ao modo: pílula fixa; painel no último tamanho escolhido e redimensionável. */
export async function applyWindowMode(mode: WidgetMode) {
  if (!inTauri) return;
  const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  const { width, height } = mode === "pill" ? WINDOW_SIZES.pill : panelSize();
  await w.setResizable(mode !== "pill");
  await w.setSize(new LogicalSize(width, height));
}

/** Guarda o tamanho do painel quando a pessoa redimensiona (ignora a pílula). Devolve a função para parar. */
export async function watchPanelSize(isPanel: () => boolean): Promise<() => void> {
  if (!inTauri) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  return w.onResized(async ({ payload }) => {
    if (!isPanel()) return;
    const k = await w.scaleFactor();
    const size = { width: payload.width / k, height: payload.height / k };
    if (size.width >= PANEL_MIN.width && size.height >= PANEL_MIN.height) savePanelSize(size);
  });
}

/** Puxador do canto: redimensiona a janela sem bordas (a borda nativa não existe com decorations: false). */
export function resizeFromMouseDown(e: ReactMouseEvent) {
  if (!inTauri || e.button !== 0) return;
  e.preventDefault();
  void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().startResizeDragging("SouthEast"));
}

/**
 * Arrasta a janela a partir de um mousedown. Mais confiável que `data-tauri-drag-region`,
 * que só vale para o elemento exato clicado (filhos não herdam).
 * Ignora cliques em controles interativos e duplo clique.
 */
export function dragFromMouseDown(e: ReactMouseEvent) {
  if (!inTauri || e.button !== 0 || e.detail > 1) return;
  if ((e.target as HTMLElement).closest("button, input, select, textarea, a, label")) return;
  void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().startDragging());
}

export async function hideWindow() {
  if (!inTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

/** Eventos vindos da bandeja (pausar/retomar sincronização). */
export async function onTrayEvent(name: "sync-paused", cb: (paused: boolean) => void) {
  if (!inTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<boolean>(name, (e) => cb(e.payload));
}
