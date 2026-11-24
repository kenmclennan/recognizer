import {
  NO_CHANGES,
  ScanBaseline,
  type ScanOrigin,
} from "../../domain/history/scan-baseline.js";
import type { WindowBaselines } from "../../domain/history/window-baselines.js";
import type { ScanBaselinePorts } from "./scan-baseline-ports.js";

export function adoptScanBaseline(
  ports: ScanBaselinePorts,
  windows: WindowBaselines,
  window: string,
  root: string,
): ScanOrigin {
  const state = windows.peek(window);

  if (state === undefined || state.origin === null) {
    throw new Error("no scan is waiting to be adopted");
  }

  const baseline = new ScanBaseline(
    ports.recordedScans.read(root),
    state.origin,
  );

  state.baseline = baseline;
  state.origin = null;
  state.published = NO_CHANGES;

  return baseline.shortOrigin();
}
