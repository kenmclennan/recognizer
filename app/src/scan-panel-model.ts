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
import { describeRateMs, NO_HISTORY, type ScanHistory } from "./scan-estimate";
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
import {
  foldSummary,
  type SuiteRowModel,
  type SuiteRunning,
  type SuiteTone,
  shortAge,
  suiteRows,
  tickedResults,
} from "./suite-results";
import {
  type SuiteRef,
  type SuiteTickEntry,
  sensorArmed,
  sensorTickState,
  suitePlan,
  type TickState,
  tickedSuites,
} from "./suite-ticks";

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
  suites: Record<string, SuiteTickEntry>;
  folds: string[];
};

export type ScanPlan = {
  describe: boolean;
  describeAll: boolean;
  sense: string[];
  modules: string[] | null;
  suites?: Record<string, string[]>;
};

export type PanelView = { name: string | null; modules: string[] };

export type RowSensor = {
  name: string;
  display: string;
  title: string;
  runsTests: boolean;
  suites?: SuiteRef[];
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
  history?: ScanHistory;
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
  stateTitle: string;
  tick: TickState;
  tone: SuiteTone | null;
  fold: FoldModel | null;
};

export type FoldModel = {
  open: boolean;
  suites: SuiteRowModel[];
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

function suitesOf(config: string | null): SuiteRef[] {
  return (readConfig(config)?.tests ?? []).map(({ name, language }) => ({
    name,
    language,
  }));
}

export function rowSensors(
  config: string | null,
  shipped: ShippedSensors | null,
): RowSensor[] {
  const rows: RowSensor[] = [];
  const suites = suitesOf(config);

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
        ...(one.runsTests && suites.length > 0 ? { suites } : {}),
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
  rows: Pick<RowSensor, "name" | "runsTests" | "suites">[],
): { plan: ScanPlan; dropped: string[] } {
  const testing = rows
    .filter(({ runsTests }) => runsTests)
    .map(({ name }) => name);
  const planned = suitePlan(
    ticks,
    rows.filter(({ runsTests }) => runsTests),
    ticks.once,
  );
  const plain = rows
    .filter(({ runsTests }) => !runsTests)
    .map(({ name }) => name);
  const wanted = ticks.ticked ?? plain;
  const known = [...plain, ...testing];
  const sense = [
    ...wanted.filter((name) => plain.includes(name)),
    ...testing.filter((name) => planned.sense.includes(name)),
  ];

  return {
    plan: {
      describe: ticks.describe,
      describeAll: false,
      sense,
      modules: null,
      suites: planned.suites,
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

function structureNote(input: PanelInput): string | null {
  const status = input.sensors.find(({ name }) => name === STRUCTURE_KEY);

  return status?.notMeasured?.includes("duplication") === true
    ? "Duplication: run a scan"
    : null;
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
          ? sensorArmed(
              input.ticks,
              sensors.find((one) => one.name === key) ?? { name: key },
            )
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

  const progress =
    input.runView?.progress.sensorProgress ?? input.sensorProgress;
  const sensing = input.runView?.progress.sensing ?? null;

  const rows: ScanRow[] = freshness.rows.map((row) => {
    const structure = row.key === STRUCTURE_KEY;
    const sensor = sensors.find((one) => one.name === row.key);
    const names = (sensor?.suites ?? []).map(({ name }) => name);
    const foldable = sensor?.runsTests === true && names.length > 0;
    const full = stateText(row.state, input.now);
    const note =
      row.key === DESCRIBE_KEY
        ? judged.describeStop != null
          ? describeStopText(judged.describeStop)
          : judged.describeSkipped === true
            ? "skipped this scan"
            : null
        : structure
          ? structureNote(judged)
          : stoppedNote(row.key, judged);
    const why =
      structure || row.key === DESCRIBE_KEY ? null : whyFor(row.key, judged);
    const titled = [
      full.text,
      ...(why === null ? [] : [why.segments.map(({ text }) => text).join("")]),
      ...(note === null ? [] : [note]),
    ].join(": ");
    const base = {
      key: row.key,
      name: row.name,
      tickable: row.tickable,
      disabled: structure || locked,
      state: row.state,
      note,
      why,
      title: titles.get(row.key) ?? row.name,
    };

    if (foldable && sensor !== undefined) {
      const ticked = tickedSuites(input.ticks.suites, row.key, names);
      const results = statuses.find((one) => one.name === row.key)?.suites;
      const live =
        (input.scanning || run?.active === true) &&
        progress != null &&
        progress.name === row.key &&
        (sensing === null || sensing === row.key)
          ? runningOf(progress)
          : null;
      const summary = foldSummary({
        all: names.length,
        results: tickedResults(sensor.suites ?? [], ticked, results),
        running: live,
        now: input.now,
      });
      const tick = sensorTickState(input.ticks, row.key, names);

      return {
        ...base,
        ticked: tick === "on",
        tick,
        tone: summary.tone,
        text: { icon: summary.icon, text: summary.text },
        stateTitle: `${summary.text}`,
        fold: {
          open: input.ticks.folds.includes(row.key),
          suites: suiteRows({
            sensor: row.key,
            suites: sensor.suites ?? [],
            ticked,
            results,
            running: live,
            locked,
            now: input.now,
          }),
        },
      };
    }

    const current =
      row.state.kind === "current" && row.state.at !== null
        ? { icon: full.icon, text: shortAge(input.now - row.state.at) }
        : full;
    const isTicked = structure
      ? true
      : row.key === DESCRIBE_KEY
        ? input.ticks.describe
        : sensor?.runsTests === true
          ? input.ticks.once.includes(row.key)
          : (input.ticks.ticked ?? plain).includes(row.key);

    return {
      ...base,
      ticked: isTicked,
      tick: isTicked ? "on" : "off",
      tone: null,
      text:
        run?.partial?.sensor === row.key
          ? { icon: "circle-dashed", text: run.partial.text }
          : current,
      stateTitle: titled,
      fold: null,
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
      input.describeAsk == null
        ? null
        : describeAskText(
            input.describeAsk,
            describeRateMs(input.history ?? NO_HISTORY),
          ),
  };
}

function runningOf(progress: SensorProgress): SuiteRunning | null {
  if (progress.suite === undefined) {
    return null;
  }

  return progress.step === "mutants"
    ? { suite: progress.suite, done: progress.done, total: progress.total }
    : { suite: progress.suite, done: null, total: null };
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
