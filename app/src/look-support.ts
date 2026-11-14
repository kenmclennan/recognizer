import type { Scheduler } from "./bar-hover";
import type { CommitsPort } from "./commits-port";
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

export function registeredWith(
  rows: (Pick<RowSensor, "name" | "display" | "runsTests"> &
    Partial<Pick<RowSensor, "registered" | "suites">>)[],
  describerRegistered = true,
): Registered {
  return {
    sensors: rows.map((row) => ({ registered: true, ...row })),
    describerRegistered,
  };
}

export function registeredOf(
  rows: RowSensor[],
  describerRegistered = true,
): Registered {
  return {
    sensors: rows.map(({ name, display, runsTests, registered, suites }) => ({
      name,
      display,
      runsTests,
      registered,
      ...(suites === undefined ? {} : { suites }),
    })),
    describerRegistered,
  };
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
  withdraw?: (id: number) => void;
  reconcileMessages?: (foundKeys: readonly string[]) => void;
  comparisons?: ViewComparisons;
  commits?: CommitsPort;
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
    options.withdraw,
    options.reconcileMessages,
    options.comparisons,
    options.commits,
  );
}
