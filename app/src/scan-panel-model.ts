import type { Diagnosis, Freshness } from "recognizer";
import {
  type Config,
  parseConfig,
  registeredSensors,
  type Scan,
  shippedSensorNames,
} from "recognizer";
import { scopeCaption } from "./findings-scope";
import { ageText, type ScanState } from "./footer-scan";
import {
  buildFreshnessModel,
  type FreshnessModel,
  type ResultState,
  STRUCTURE_KEY,
  type StateText,
  stateText,
} from "./freshness-model";
import type { ResponsibilityState } from "./responsibility-model";
import {
  DESCRIBE_KEY,
  MUTATION_KEY,
  markStale,
  type PlannedRun,
  planFor,
  type ResultsMode,
} from "./scan-freshness";
import {
  type DescribeAsk,
  type DescribeAskText,
  type DescribeStop,
  describeAskText,
  describeStopText,
  type SensorProgress,
} from "./scan-progress";
import { type RunInput, type RunModel, runModel } from "./scan-run-model";
import { type ScanWhy, whyOf } from "./scan-why";
import type { SensorStatus, ShippedSensors } from "./sensor-run";

export type RunState = {
  running: string[];
  started: string | null;
  failures: Record<string, string>;
  diagnoses: Record<string, Diagnosis>;
  ranAt: Record<string, number>;
};

export const NO_RUN: RunState = {
  running: [],
  started: null,
  failures: {},
  diagnoses: {},
  ranAt: {},
};

export { DESCRIBE_KEY, MUTATION_KEY };

export type ScanTicks = {
  describe: boolean;
  ticked: string[] | null;
  once: string[];
  onlyView: boolean;
};

export type ScanPlan = {
  describe: boolean;
  describeAll: boolean;
  sense: string[];
  modules: string[] | null;
};

export type PanelView = { name: string | null; modules: string[] };

export type RowSensor = {
  name: string;
  display: string;
  title: string;
  runsTests: boolean;
};

export type PanelInput = {
  scan: ScanState | null;
  config: string | null;
  sensors: SensorStatus[];
  lines: { modules: string[]; of: (id: string) => ResponsibilityState };
  describedAt: number | null;
  ticks: ScanTicks;
  view?: PanelView | null;
  mode?: ResultsMode;
  scans?: Scan[];
  run: RunState;
  scanning: boolean;
  external?: boolean;
  progressText?: string | null;
  describeProgress?: { entries: number; total: number } | null;
  describeStop?: DescribeStop | null;
  describeAsk?: DescribeAsk | null;
  describeSkipped?: boolean;
  sensorProgress?: SensorProgress | null;
  extracting?: boolean;
  runModules?: number;
  now: number;
  shipped: ShippedSensors | null;
  freshness?: Freshness;
  runView?: RunInput | null;
};

export type ScanRow = {
  key: string;
  name: string;
  tickable: boolean;
  ticked: boolean;
  disabled: boolean;
  state: ResultState;
  text: StateText;
  note: string | null;
  why: ScanWhy | null;
  title: string;
};

export type ReportRow = {
  name: string;
  chip: string;
  commit: string;
  stale: boolean;
};

export type ScanPanelModel = {
  header: { text: string; moved: string | null };
  scope: {
    caption: string;
    on: boolean;
    disabled: boolean;
    canvasEmpty: boolean;
  } | null;
  freshness: FreshnessModel;
  summary: FreshnessModel["summary"];
  run: RunModel | null;
  rows: ScanRow[];
  reports: ReportRow[];
  button: {
    scanning: boolean;
    label: string;
    disabled: boolean;
    stop?: boolean;
  };
  mode: FreshnessModel["action"]["mode"];
  planned: PlannedRun | null;
  pending: boolean;
  mark: boolean;
  confirm: DescribeAskText | null;
};

const DESCRIBE_TITLE =
  "Writes one line per module saying what it is responsible for.";

function readConfig(config: string | null): Config | null {
  if (config === null) {
    return null;
  }

  try {
    return parseConfig(config);
  } catch {
    return null;
  }
}

const EXPANSIONS: Record<string, string> = {
  crap: "C.R.A.P.: Change Risk Anti-Patterns.",
};

function titleFor(one: { name: string; line: string }): string {
  const expansion = EXPANSIONS[one.name];

  return expansion === undefined ? one.line : `${expansion} ${one.line}`;
}

export function rowSensors(
  config: string | null,
  shipped: ShippedSensors | null,
): RowSensor[] {
  const rows: RowSensor[] = [];

  if (shipped?.status === "ok") {
    const listed = shipped.sensors
      .filter(({ listed }) => listed)
      .sort((a, b) => a.display.localeCompare(b.display));

    for (const one of listed) {
      rows.push({
        name: one.name,
        display: one.display,
        title: titleFor(one),
        runsTests: one.runsTests,
      });
    }
  }

  const parsed = readConfig(config);
  const known = new Set(shippedSensorNames());

  if (parsed !== null) {
    for (const { name } of registeredSensors(parsed)) {
      if (!known.has(name)) {
        rows.push({ name, display: name, title: name, runsTests: false });
      }
    }
  }

  return rows;
}

export function phasesFor(
  ticks: ScanTicks,
  rows: Pick<RowSensor, "name" | "runsTests">[],
): { plan: ScanPlan; dropped: string[] } {
  const testing = rows
    .filter(({ runsTests }) => runsTests)
    .map(({ name }) => name);
  const plain = rows
    .filter(({ runsTests }) => !runsTests)
    .map(({ name }) => name);
  const wanted = ticks.ticked ?? plain;
  const known = [...plain, ...testing];
  const sense = [
    ...wanted.filter((name) => plain.includes(name)),
    ...testing.filter((name) => ticks.once.includes(name)),
  ];

  return {
    plan: {
      describe: ticks.describe,
      describeAll: false,
      sense,
      modules: null,
    },
    dropped: wanted.filter((name) => !known.includes(name)),
  };
}

export function functionCount(scans: Scan[], ids: string[] | null): number {
  const wanted = ids === null ? null : new Set(ids);
  let count = 0;

  for (const scan of scans) {
    for (const module of scan.modules) {
      if (wanted !== null && !wanted.has(module.id)) {
        continue;
      }

      for (const member of module.members ?? []) {
        if (member.kind === "function") {
          count += 1;
        } else if (member.kind === "class") {
          count += member.methods?.length ?? 0;
        }
      }
    }
  }

  return count;
}

function scopedIds(input: PanelInput): string[] | null {
  return input.ticks.onlyView && input.view ? input.view.modules : null;
}

function whyFor(name: string, input: PanelInput): ScanWhy | null {
  if (input.scanning && input.run.running.includes(name)) {
    return null;
  }

  if (input.run.failures[name] !== undefined) {
    const refusal = input.run.diagnoses[name];

    return refusal === undefined ? null : whyOf(refusal);
  }

  const status = input.sensors.find((one) => one.name === name);

  if (status?.refusal !== undefined) {
    return status.refusal.diagnosis === undefined
      ? null
      : whyOf(status.refusal.diagnosis);
  }

  if (
    (status?.status === "ran" || status?.status === "stale") &&
    status.diagnosis !== undefined &&
    status.diagnosis.code !== "tool-missing"
  ) {
    return whyOf(status.diagnosis);
  }

  return null;
}

function stoppedNote(name: string, input: PanelInput): string | null {
  const status = input.sensors.find((one) => one.name === name);

  if (
    (status?.status !== "ran" && status?.status !== "stale") ||
    status.stopped === undefined
  ) {
    return null;
  }

  const { measured, total } = status.stopped;

  return measured > 0
    ? `stopped, ${measured} of ${total} functions measured`
    : "stopped, nothing measured";
}

function reportRows(sensors: SensorStatus[], now: number): ReportRow[] {
  return sensors
    .filter((one) => one.reported !== undefined)
    .map((one) => {
      const { at, commit } = one.reported as { at: string; commit: string };
      const when = Date.parse(at);

      return {
        name: one.name,
        chip: Number.isNaN(when)
          ? "reported"
          : `reported ${ageText(when, now)}`,
        commit: commit.slice(0, 7),
        stale: one.status === "stale",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function movedText(input: PanelInput): string | null {
  const moved = input.scan?.changes.moved ?? null;

  if (moved === null) {
    return null;
  }

  return moved.branch === null
    ? `Now at ${moved.commit}`
    : `Now on ${moved.branch} at ${moved.commit}`;
}

function header(
  input: PanelInput,
  run: RunModel | null,
): ScanPanelModel["header"] {
  if (run?.active === true) {
    return { text: run.subtitle, moved: null };
  }

  if (input.scanning) {
    return { text: input.progressText ?? "Scanning\u2026", moved: null };
  }

  if (input.scan === null) {
    return { text: "Not scanned yet", moved: null };
  }

  return {
    text: `Ran ${ageText(input.scan.scannedAt, input.now)}`,
    moved: movedText(input),
  };
}

function structureTitle(): string {
  return "Structure always runs";
}

export function scanPanel(input: PanelInput): ScanPanelModel {
  const sensors = rowSensors(input.config, input.shipped);
  const statuses =
    input.freshness === undefined
      ? input.sensors
      : markStale(input.sensors, input.freshness);
  const judged: PanelInput = { ...input, sensors: statuses };
  const freshness = buildFreshnessModel(judged, sensors);

  if (input.shipped === null) {
    return {
      header: header(input, null),
      scope: null,
      freshness,
      summary: freshness.summary,
      run: null,
      rows: [],
      reports: [],
      button: {
        scanning: input.scanning && input.external !== true,
        label: input.scanning ? "Running" : "Run",
        disabled: input.scanning,
      },
      mode: freshness.action.mode,
      planned: null,
      pending: true,
      mark: panelMark(input),
      confirm: null,
    };
  }

  const planned = planFor(
    freshness,
    input.mode ?? "bring",
    input.ticks,
    sensors,
    scopedIds(input),
    input.lines.modules,
  );
  const plain = sensors
    .filter(({ runsTests }) => !runsTests)
    .map(({ name }) => name);
  const titles = new Map<string, string>([
    [STRUCTURE_KEY, structureTitle()],
    [DESCRIBE_KEY, DESCRIBE_TITLE],
    ...sensors.map((one): [string, string] => [one.name, one.title]),
  ]);

  const plainTicked = (key: string, runsTests: boolean | undefined): boolean =>
    key === STRUCTURE_KEY
      ? true
      : key === DESCRIBE_KEY
        ? input.ticks.describe
        : runsTests === true
          ? input.ticks.once.includes(key)
          : (input.ticks.ticked ?? plain).includes(key);
  const tickedKeys = new Set(
    freshness.rows
      .filter(
        (row) =>
          row.key !== STRUCTURE_KEY &&
          plainTicked(
            row.key,
            sensors.find((one) => one.name === row.key)?.runsTests,
          ),
      )
      .map((row) => row.key),
  );
  const displayOf = (name: string): string =>
    freshness.rows.find((row) => row.key === name)?.name ?? name;
  const run = runModel(
    input.runView == null ? null : { ...input.runView, display: displayOf },
    tickedKeys,
    new Set([...tickedKeys].filter((key) => key !== DESCRIBE_KEY)),
    input.now,
  );
  const locked = input.scanning || run?.active === true;

  const rows: ScanRow[] = freshness.rows.map((row) => {
    const structure = row.key === STRUCTURE_KEY;
    const sensor = sensors.find((one) => one.name === row.key);

    return {
      key: row.key,
      name: row.name,
      tickable: row.tickable,
      ticked: structure
        ? true
        : row.key === DESCRIBE_KEY
          ? input.ticks.describe
          : sensor?.runsTests === true
            ? input.ticks.once.includes(row.key)
            : (input.ticks.ticked ?? plain).includes(row.key),
      disabled: structure || locked,
      state: row.state,
      text:
        run?.partial?.sensor === row.key
          ? { icon: "circle-dashed", text: run.partial.text }
          : stateText(row.state, input.now),
      note:
        row.key === DESCRIBE_KEY
          ? judged.describeStop != null
            ? describeStopText(judged.describeStop)
            : judged.describeSkipped === true
              ? "skipped this scan"
              : null
          : stoppedNote(row.key, judged),
      why:
        structure || row.key === DESCRIBE_KEY ? null : whyFor(row.key, judged),
      title: titles.get(row.key) ?? row.name,
    };
  });

  return {
    header: header(input, run),
    scope: scopeOf(input),
    freshness,
    summary: freshness.summary,
    run,
    rows,
    reports: reportRows(statuses, input.now),
    button: buttonOf(input, run, freshness.action.primary),
    mode: freshness.action.mode,
    planned,
    pending: false,
    mark: panelMark(input),
    confirm:
      input.describeAsk == null ? null : describeAskText(input.describeAsk),
  };
}

function buttonOf(
  input: PanelInput,
  run: RunModel | null,
  primary: { label: string; disabled: boolean },
): ScanPanelModel["button"] {
  if (run?.active === true) {
    return {
      scanning: true,
      label: run.button.label,
      disabled: false,
      stop: true,
    };
  }

  if (run?.refused === true) {
    return {
      scanning: false,
      label: run.button.label,
      disabled: false,
    };
  }

  return {
    scanning: input.scanning && input.external !== true,
    label: primary.label,
    disabled: primary.disabled,
  };
}

function scopeOf(input: PanelInput): ScanPanelModel["scope"] {
  if (!input.view) {
    return null;
  }

  return {
    caption: scopeCaption(input.view.name, input.view.modules.length),
    on: input.ticks.onlyView,
    disabled: input.scanning,
    canvasEmpty: input.view.modules.length === 0,
  };
}

function panelMark(input: PanelInput): boolean {
  return (
    input.sensors.some(({ status }) => status === "failed") ||
    Object.keys(input.run.failures).length > 0
  );
}
