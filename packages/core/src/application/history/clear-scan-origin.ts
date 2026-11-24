import type { WindowBaselines } from "../../domain/history/window-baselines.js";

export function clearScanOrigin(
  windows: WindowBaselines,
  window: string,
  closed = false,
): null {
  if (closed) {
    windows.drop(window);
  } else {
    const state = windows.peek(window);

    if (state !== undefined) {
      state.origin = null;
    }
  }

  return null;
}
