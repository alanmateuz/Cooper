import { isTauri } from "@tauri-apps/api/core";
import type { MouseEvent as ReactMouseEvent } from "react";

export type WidgetMode = "pill" | "compact" | "expanded";

export const WINDOW_SIZES: Record<WidgetMode, { width: number; height: number }> = {
  pill: { width: 220, height: 44 },
  compact: { width: 360, height: 520 },
  expanded: { width: 360, height: 520 },
};

export const inTauri = isTauri();

/** Ajusta a janela nativa ao modo; no navegador não faz nada (o App simula a moldura). */
export async function applyWindowMode(mode: WidgetMode) {
  if (!inTauri) return;
  const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
  const { width, height } = WINDOW_SIZES[mode];
  await getCurrentWindow().setSize(new LogicalSize(width, height));
}

/**
 * Arrasta a janela a partir de um mousedown. Mais confiável que `data-tauri-drag-region`,
 * que só vale para o elemento exato clicado (filhos não herdam).
 * Ignora cliques em controles interativos e duplo clique.
 */
export function dragFromMouseDown(e: ReactMouseEvent) {
  if (!inTauri || e.button !== 0 || e.detail > 1) return;
  if ((e.target as HTMLElement).closest("button, input, select, textarea, a")) return;
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
