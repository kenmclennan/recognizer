import { Repository, type SensorFindings } from "@recognizer/core";
import type { Scheduler } from "../../src/bar-hover";
import type { CommitsPort } from "../../src/commits-port";
import type { EditorPort } from "../../src/editor-port";
import {
  type Carried,
  type Explorer,
  inertScanHost,
  type ScanHost,
  showExplorer,
} from "../../src/explorer";
import type { MessageInput } from "../../src/message-tray";
import type { Registered } from "../../src/rescanner";
import type { ResponsibilitiesPort } from "../../src/responsibilities-port";
import type { Loaded } from "../../src/scan-loading";
import type { RowSensor } from "../../src/scan-panel-model";
import type { ViewComparisons } from "../../src/view-comparisons";
import type { ViewsPort } from "../../src/views-port";
import type { WindowPort } from "../../src/window-port";
import { factsFor, measuredOfDocument, splitFor } from "../freshness-support";
import { type DocScan, repositoryFrom } from "./repository-from";
import {
  type FindingsLiteral,
  sensorFindingsFrom,
} from "./sensor-findings-from";

const BASE: Loaded = {
  modules: [],
  scans: [],
  repository: Repository.empty,
  policy: null,
  baseline: null,
  notices: [],
  blocking: null,
  findings: [],
  split: {},
  sensors: [],
};

type GivenScan = {
  file: string;
  scan?: DocScan;
  repository?: Loaded["repository"];
};

export function loadedOf(
  overrides: Omit<Partial<Loaded>, "scans" | "findings"> & {
    scans?: GivenScan[];
    findings?: (SensorFindings | FindingsLiteral)[];
  } = {},
): Loaded {
  const { scans: given, findings: givenFindings, ...rest } = overrides;
  const findings = (givenFindings ?? []).map((one) =>
    "findings_version" in one
      ? sensorFindingsFrom(one)
      : (one as SensorFindings),
  );
  const scans = (given ?? []).map(({ file, scan, repository }) => ({
    file,
    repository:
      repository ??
      repositoryFrom(
        scan === undefined ? [] : [scan],
        /^scan\.(.+)\.json$/.exec(file)?.[1] ?? "python",
      ),
  }));

  const repository =
    given === undefined
      ? BASE.repository
      : Repository.join(scans.map((one) => one.repository));

  return {
    ...BASE,
    ...rest,
    findings,
    scans,
    repository,
    freshness:
      rest.freshness !== undefined && Object.keys(rest.freshness).length > 0
        ? rest.freshness
        : factsFor(
            repository,
            [...findings.map(measuredOfDocument), ...(rest.sensors ?? [])],
            rest.tests ?? null,
          ),
    split:
      rest.split !== undefined && Object.keys(rest.split).length > 0
        ? rest.split
        : splitFor(repository, findings, rest.tests ?? null),
  };
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
  timeZone?: string;
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
    undefined,
    undefined,
    options.timeZone,
  );
}
