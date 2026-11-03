import type { Scheduler } from "./bar-hover";
import type { EditorPort } from "./editor-port";
import {
  type Carried,
  type Explorer,
  inertScanHost,
  type ScanHost,
  showExplorer,
} from "./explorer";
import type { MessageInput } from "./message-tray";
import type { Registered } from "./rescanner";
import type { ResponsibilitiesPort } from "./responsibilities-port";
import type { Loaded } from "./scan-loading";
import type { RowSensor } from "./scan-panel-model";
import type { ViewComparisons } from "./view-comparisons";
import type { ViewsPort } from "./views-port";
import type { WindowPort } from "./window-port";

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
  return rows.map(({ name, display, runsTests }): Registered[number] => ({
    name,
    display,
    runsTests,
  }));
}

export type ExplorerOptions = {
  container: HTMLElement;
  loaded: Loaded;
  title: string;
  onCount?: (text: string) => void;
  views?: ViewsPort;
  post?: (input: MessageInput) => number | null;
  carried?: Carried | null;
  scheduler?: Scheduler;
  storage?: Pick<Storage, "getItem" | "setItem">;
  editor?: EditorPort;
  responsibilities?: ResponsibilitiesPort;
  windowPort?: WindowPort;
  scanHost?: ScanHost;
  showMetrics?: (text: string | null) => void;
  withdraw?: (id: number) => void;
  reconcileMessages?: (foundKeys: readonly string[]) => void;
  comparisons?: ViewComparisons;
};

export function mountExplorer(options: ExplorerOptions): Explorer {
  return showExplorer(
    options.container,
    options.loaded,
    options.title,
    options.onCount,
    options.views,
    options.post,
    options.carried,
    options.scheduler,
    options.storage,
    options.editor,
    options.responsibilities,
    options.windowPort,
    options.scanHost,
    options.showMetrics,
    options.withdraw,
    options.reconcileMessages,
    options.comparisons,
  );
}
