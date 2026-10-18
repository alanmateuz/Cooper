import { isTauri } from "@tauri-apps/api/core";

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
