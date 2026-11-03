import { inertScanHost, type ScanHost } from "./explorer";
import type { Registered } from "./rescanner";
import type { Loaded } from "./scan-loading";
import type { RowSensor } from "./scan-panel-model";

const BASE: Loaded = {
  modules: [],
  scans: [],
  policy: null,
  baseline: null,
  notices: [],
  blocking: null,
  findings: [],
  sensors: [],
};

export function loadedOf(overrides: Partial<Loaded> = {}): Loaded {
  return { ...BASE, ...overrides };
}

export function scanHostOf(overrides: Partial<ScanHost> = {}): ScanHost {
  return { ...inertScanHost, ...overrides };
}

export function registeredOf(rows: RowSensor[]): Registered {
  return rows.map(({ name, runsTests }): Registered[number] => ({
    name,
    runsTests,
  }));
}
