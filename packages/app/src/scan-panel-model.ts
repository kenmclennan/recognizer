import {
  type DescribeAsk,
  type DescribeHalt,
  type Diagnosis,
  type DocumentFreshness,
  Repository,
} from "@recognizer/core";
import type { PlanRequest, ScanPlanView } from "recognizer";
import {
  type Config,
  registeredSensors,
  type ScanIntent,
  type ScanTicks,
  type SuiteRef,
  sensorArmed,
  sensorTickState,
  type TickState,
  tickedSuites,
  unregisteredMessage,
  visibleSuiteTicks,
} from "recognizer";
import {
  type EstimateAnswer,
  type EstimateRequest,
  estimateLine,
  type PlannedWork,
  type ScanEstimate,
} from "./estimate-text";
import { scopeCaption } from "./findings-scope";
import { ageText, type ScanState } from "./footer-scan";
import {
  ANALYSIS_KEY,
  type FreshnessModel,
  type ResultState,
  SCAN_KEY,
  type StateText,
  scopeModules,
  stateText,
  structureChanged,
  wordFreshness,
} from "./freshness-text";
import type { LoadedPlanData } from "./plan-reads";
import type { ResponsibilityState } from "./responsibility-model";
import {
  DESCRIBE_KEY,
  type PlannedRun,
  plannedRun,
  type ResultsMode,
} from "./scan-freshness";
import {
  type DescribeAskText,
  describeAskText,
  describeStopText,
  type PluginProgress,
} from "./scan-progress";
import { type RunInput, type RunModel, runModel } from "./scan-run-model";
import { type ScanWhy, whyOf } from "./scan-why";
import type { InstalledSensors, SensorStatus } from "./sensor-run";
import {
  foldSummary,
  type SuiteRowModel,
  type SuiteRunning,
  type SuiteTone,
  shortAge,
  suiteRows,
  tickedResults,
} from "./suite-results";

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

export type { ScanTicks, SuiteRef };
export { DESCRIBE_KEY, sensorTickState, visibleSuiteTicks };

export type ScanPlan = ScanIntent;

export type PanelView = { name: string | null; modules: string[] };

export type RowSensor = {
  name: string;
  display: string;
  title: string;
  runsTests: boolean;
  scoped: boolean;
  workVerb?: string | null;
  registered: boolean;
  suites?: SuiteRef[];
};

export type PanelInput = {
  scan: ScanState;
  config: Config | null;
  configProblem?: string | null;
  sensors: SensorStatus[];
  lines: { modules: string[]; of: (id: string) => ResponsibilityState };
  describedAt: number | null;
  ticks: ScanTicks;
  view?: PanelView | null;
  mode?: ResultsMode;
  runMode?: ResultsMode;
  scans?: Repository;
  run: RunState;
  scanning: boolean;
  external?: boolean;
  progressText?: string | null;
  describeProgress?: { entries: number; total: number } | null;
  describeStop?: DescribeHalt | null;
  describeAsk?: DescribeAsk | null;
  describeSkipped?: boolean;
  sensorProgress?: PluginProgress | null;
  extracting?: boolean;
  runModules?: number;
  now: number;
  installed: InstalledSensors | null;
  freshness?: Record<string, DocumentFreshness>;
  runView?: RunInput | null;
  estimate?: EstimateAnswer | null;
  work?: Record<string, PlannedWork>;
  plan?: PlanAnswer | null;
  tests?: string | null;
};

export type PlanAnswer = { view: ScanPlanView; settled: boolean };

const NO_PLAN: ScanPlanView = {
  intent: {
    describe: false,
    describeAll: false,
    analysis: true,
    sense: [],
    modules: null,
  },
  dropped: [],
  modules: 0,
  idle: true,
  work: {},
  gaps: {},
  never: [],
};

function pendingIntent(input: PanelInput): ScanPlanView["intent"] {
  return { ...NO_PLAN.intent, analysis: input.ticks.analysis };
}

function effectiveInput(given: PanelInput, sensors: RowSensor[]): PanelInput {
  return {
    ...given,
    ticks: effectiveTicks(
      given.ticks,
      sensors,
      describerRegistered(given.config),
    ),
  };
}

export function planRequestOf(
  given: PanelInput,
  sensors: RowSensor[] = rowSensors(given.config, given.installed),
): PlanRequest {
  const input = effectiveInput(given, sensors);

  return {
    repository: ".",
    mode: input.mode ?? "bring",
    ticks: input.ticks,
    scope: scopedIds(input),
    changed: structureChanged(input, scopeModules(input)),
  };
}

export function planFactsOf(
  given: PanelInput,
  sensors: RowSensor[] = rowSensors(given.config, given.installed),
): LoadedPlanData {
  return {
    scans: given.scans ?? Repository.empty,
    measured: Object.fromEntries(
      given.sensors.map(({ name, status, measured }) => [
        name,
        status === "not run" ? null : (measured ?? {}),
      ]),
    ),
    tests: given.tests ?? null,
    describerRegistered: describerRegistered(given.config),
    lineKinds: (id) => given.lines.of(id).kind,
    sensors: sensors.map(
      ({ name, display, runsTests, scoped, registered, suites }) => ({
        name,
        display,
        runsTests,
        scoped,
        registered,
        ...(suites === undefined ? {} : { suites }),
      }),
    ),
  };
}

export type ScanRow = {
  key: string;
  name: string;
  tickable: boolean;
  ticked: boolean;
  disabled: boolean;
  unregistered?: boolean;
  state: ResultState;
  text: StateText;
  note: string | null;
  why: ScanWhy | null;
  title: string;
  stateTitle: string;
  tick: TickState;
  tone: SuiteTone | null;
  fold: FoldModel | null;
  reason?: string;
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
  estimate: ScanEstimate | null;
  estimateRequest: EstimateRequest | null;
};

const NOTHING_TICKED = "Nothing ticked to run";

const INERT_LABELS = [NOTHING_TICKED, "Nothing to run", "Checking"];

const DESCRIBE_TITLE =
  "Writes one line per file saying what it is responsible for.";

export function registeredDespiteError(names: readonly string[]): Config {
  return {
    sensors: Object.fromEntries(
      names.map((name) => [name, { command: [name] }]),
    ),
  };
}

function titleFor(one: {
  display: string;
  description: string;
  expansion?: string;
}): string {
  const text = one.description === "" ? one.display : one.description;

  return one.expansion === undefined ? text : `${one.expansion} ${text}`;
}

function suitesOf(config: Config | null): SuiteRef[] {
  return (config?.tests ?? []).map(({ name, language }) => ({
    name,
    language,
  }));
}

export function keepLastGoodSensors(
  previous: InstalledSensors | null,
  next: InstalledSensors,
): InstalledSensors {
  return next.status !== "ok" && previous?.status === "ok" ? previous : next;
}

export function rowSensors(
  parsed: Config | null,
  installed: InstalledSensors | null,
): RowSensor[] {
  const rows: RowSensor[] = [];
  const suites = suitesOf(parsed);
  const registeredNames = new Set(
    parsed === null ? [] : registeredSensors(parsed).map(({ name }) => name),
  );

  if (installed?.status === "ok") {
    const listed = installed.sensors.filter(({ listed }) => listed);

    for (const one of listed) {
      rows.push({
        name: one.name,
        display: one.display,
        title: titleFor(one),
        runsTests: one.runsTests,
        scoped: one.scoped,
        workVerb: one.plannedWork?.verb ?? null,
        registered: registeredNames.has(one.name),
        ...(one.runsTests && suites.length > 0 ? { suites } : {}),
      });
    }
  }

  const known = new Set(
    installed?.status === "ok" ? installed.sensors.map(({ name }) => name) : [],
  );

  if (parsed !== null) {
    for (const { name } of registeredSensors(parsed)) {
      if (!known.has(name)) {
        rows.push({
          name,
          display: name,
          title: name,
          runsTests: false,
          scoped: false,
          workVerb: null,
          registered: true,
        });
      }
    }
  }

  return rows;
}

export function describerRegistered(config: Config | null): boolean {
  return config?.describer !== undefined;
}

export function effectiveTicks(
  ticks: ScanTicks,
  rows: Pick<RowSensor, "name" | "runsTests" | "registered">[],
  describerIsRegistered: boolean,
): ScanTicks {
  const gone = new Set(
    rows.filter(({ registered }) => !registered).map(({ name }) => name),
  );
  const plain = rows
    .filter(({ runsTests, registered }) => !runsTests && registered)
    .map(({ name }) => name);
  const kept = (name: string) => !gone.has(name);

  return {
    ...ticks,
    describe: ticks.describe && describerIsRegistered,
    ticked:
      ticks.ticked === null
        ? gone.size === 0
          ? null
          : plain
        : ticks.ticked.filter(kept),
    armed: ticks.armed.filter(kept),
    suites: Object.fromEntries(
      Object.entries(ticks.suites).filter(([name]) => kept(name)),
    ),
  };
}

export function functionCount(scans: Repository, ids: string[] | null): number {
  const wanted = ids === null ? null : new Set(ids);
  let count = 0;

  for (const file of scans.files) {
    if (wanted !== null && !wanted.has(file.path)) {
      continue;
    }

    for (const member of file.members) {
      if (member.kind === "function") {
        count += 1;
      } else if (member.kind === "class") {
        count += member.methods?.length ?? 0;
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
    status.diagnosis !== undefined
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
  const moved = input.scan.changes.moved;

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

  return {
    text: `Ran ${ageText(input.scan.scannedAt, input.now)}`,
    moved: movedText(input),
  };
}

function analysisNote(input: PanelInput): string | null {
  const status = input.sensors.find(({ name }) => name === ANALYSIS_KEY);
  const notes = [
    ...(status?.notMeasured?.includes("duplication") === true
      ? ["Duplication: run a scan"]
      : []),
    ...(status?.notMeasured?.includes("complexity") === true
      ? ["Complexity: run a scan"]
      : []),
  ];

  return notes.length === 0 ? null : notes.join(". ");
}

const ANALYSIS_TITLE =
  "Finds import cycles, files nothing imports, unused exports, private imports, long or complex functions, duplication and policy violations. Runs with every scan and needs no tests.";

export function plannedMsOf(
  parts: readonly { key: string; ms: number | null }[],
): Record<string, number> {
  const planned: Record<string, number> = {};

  for (const { key, ms } of parts) {
    if (ms !== null) {
      planned[key] = ms;
    }
  }

  return planned;
}

export function scanPanel(given: PanelInput): ScanPanelModel {
  const sensors = rowSensors(given.config, given.installed);
  const input: PanelInput = {
    ...given,
    ticks: effectiveTicks(
      given.ticks,
      sensors,
      describerRegistered(given.config),
    ),
  };
  const statuses =
    input.freshness === undefined
      ? input.sensors
      : input.sensors.map((one) => {
          const facts = input.freshness?.[one.name];

          return one.status === "ran" &&
            one.measured !== undefined &&
            facts?.stale
            ? { ...one, status: "stale" as const }
            : one;
        });
  const judged: PanelInput = { ...input, sensors: statuses };
  const freshness = wordFreshness(judged, sensors);

  if (input.installed === null) {
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
      mode: runningMode(input, freshness.action.mode),
      planned: null,
      pending: true,
      mark: panelMark(input),
      confirm: null,
      estimate: null,
      estimateRequest: null,
    };
  }

  const unplanned = plannedRun(
    freshness,
    input.mode ?? "bring",
    input.plan?.view ?? { ...NO_PLAN, intent: pendingIntent(input) },
    sensors,
  );
  const estimateRequest: EstimateRequest = {
    intent: {
      describe: unplanned.plan.describe,
      analysis: unplanned.plan.analysis,
      sense: unplanned.plan.sense,
    },
    planWork: unplanned.work,
    parts: freshness.rows.map((row) => ({
      key: row.key,
      name: row.name,
      runsTests:
        sensors.find((one) => one.name === row.key)?.runsTests === true,
      scoped: sensors.find((one) => one.name === row.key)?.scoped === true,
      workVerb: sensors.find((one) => one.name === row.key)?.workVerb ?? null,
    })),
    work: input.work ?? {},
  };
  const answered = input.estimate ?? null;
  const planned: PlannedRun = {
    ...unplanned,
    plannedMs: plannedMsOf(answered?.parts ?? []),
  };
  const plain = sensors
    .filter(({ runsTests }) => !runsTests)
    .map(({ name }) => name);
  const titles = new Map<string, string>([
    [ANALYSIS_KEY, ANALYSIS_TITLE],
    [DESCRIBE_KEY, DESCRIBE_TITLE],
    ...sensors.map((one): [string, string] => [one.name, one.title]),
  ]);

  const plainTicked = (key: string, runsTests: boolean | undefined): boolean =>
    key === ANALYSIS_KEY
      ? input.ticks.analysis
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
          row.key !== SCAN_KEY &&
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
    input.runView == null
      ? null
      : {
          ...input.runView,
          display: displayOf,
        },
    tickedKeys,
    new Set([...tickedKeys].filter((key) => key !== DESCRIBE_KEY)),
    input.now,
  );
  const locked = input.scanning || run?.active === true;
  const sensorSettingsError = input.configProblem ?? null;

  const progress =
    input.runView?.progress.sensorProgress ?? input.sensorProgress;
  const sensing = input.runView?.progress.sensing ?? null;

  const rows: ScanRow[] = freshness.rows
    .filter((row) => row.key !== SCAN_KEY)
    .map((row) => {
      const structure = row.key === ANALYSIS_KEY;
      const sensor = sensors.find((one) => one.name === row.key);
      const names = (sensor?.suites ?? []).map(({ name }) => name);
      const foldable = sensor?.runsTests === true && names.length > 0;
      const status = statuses.find((one) => one.name === row.key);
      const undeclared =
        !structure &&
        row.key !== DESCRIBE_KEY &&
        status?.undeclared !== undefined &&
        status.notMeasured?.includes("suites") === true
          ? status.undeclared
          : null;
      const shown: ResultState =
        undeclared !== null &&
        (row.state.kind === "current" || row.state.kind === "out-of-date")
          ? { kind: "not-measured" }
          : row.state;
      const full = stateText(shown, input.now);
      const note =
        row.key === DESCRIBE_KEY
          ? judged.describeStop != null
            ? describeStopText(judged.describeStop)
            : judged.describeSkipped === true
              ? "skipped this scan"
              : null
          : structure
            ? analysisNote(judged)
            : (stoppedNote(row.key, judged) ??
              (status?.undeclared === undefined
                ? null
                : status.undeclared.line));
      const why =
        structure || row.key === DESCRIBE_KEY ? null : whyFor(row.key, judged);
      const titled = [
        full.text,
        ...(why === null
          ? []
          : [why.segments.map(({ text }) => text).join("")]),
        ...(note === null ? [] : [note]),
      ].join(": ");
      const base = {
        key: row.key,
        name: row.name,
        tickable: row.tickable,
        disabled: locked,
        state: shown,
        note,
        why,
        title: titles.get(row.key) ?? row.name,
      };

      if (
        foldable &&
        sensor !== undefined &&
        row.state.kind !== "checking" &&
        sensorSettingsError === null
      ) {
        const ticked = tickedSuites(input.ticks.suites, row.key, names);
        const results = statuses.find((one) => one.name === row.key)?.suites;
        const live =
          (input.scanning || run?.active === true) &&
          progress != null &&
          progress.name === row.key &&
          (sensing === null || sensing === row.key)
            ? runningOf(progress, names)
            : null;
        const summary = foldSummary({
          all: names.length,
          results: tickedResults(sensor.suites ?? [], ticked, results),
          running: live,
          now: input.now,
        });
        const tick = sensorTickState(input.ticks, row.key, names);
        const behind =
          row.state.kind === "out-of-date" && summary.tone === "ok";

        return {
          ...base,
          ticked: tick === "on",
          tick,
          tone: behind ? null : summary.tone,
          text: behind ? full : { icon: summary.icon, text: summary.text },
          stateTitle: behind ? titled : `${summary.text}`,
          fold: {
            open: input.ticks.folds.includes(row.key),
            suites: suiteRows({
              sensor: row.key,
              suites: sensor.suites ?? [],
              ticked: visibleSuiteTicks(input.ticks, row.key, names),
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
        ? input.ticks.analysis
        : row.key === DESCRIBE_KEY
          ? input.ticks.describe
          : sensor?.runsTests === true
            ? input.ticks.armed.includes(row.key)
            : (input.ticks.ticked ?? plain).includes(row.key);

      if (sensorSettingsError !== null && sensor !== undefined) {
        return {
          ...base,
          ticked: isTicked,
          tick: isTicked ? "on" : "off",
          tone: "bad",
          text: { icon: "circle-x", text: "settings error" },
          stateTitle: sensorSettingsError,
          reason: sensorSettingsError,
          fold: null,
        };
      }

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

  const unregisteredRows: ScanRow[] = sensors
    .filter(({ registered }) => !registered)
    .map((one) => ({
      key: one.name,
      name: one.display,
      tickable: false,
      ticked: false,
      disabled: true,
      unregistered: true,
      state: { kind: "never-run" },
      text: { icon: "circle-dashed", text: "not registered" },
      note: null,
      why: null,
      title: one.title,
      stateTitle: unregisteredMessage(one.name),
      tick: "off",
      tone: null,
      fold: null,
    }));

  return {
    header: header(input, run),
    scope: scopeOf(input),
    freshness,
    summary: freshness.summary,
    run,
    rows: [...rows, ...unregisteredRows],
    reports: reportRows(statuses, input.now),
    button: buttonOf(input, run, freshness.action.primary),
    mode: runningMode(input, freshness.action.mode),
    planned,
    pending: false,
    mark: panelMark(input),
    confirm:
      input.describeAsk == null
        ? null
        : describeAskText(input.describeAsk, answered?.describeRateMs ?? null),
    estimate:
      locked ||
      planned.idle ||
      INERT_LABELS.includes(freshness.action.primary.label)
        ? null
        : estimateLine(answered?.parts ?? []),
    estimateRequest,
  };
}

function runningOf(
  progress: PluginProgress,
  suites: readonly string[],
): SuiteRunning {
  const counted = progress.progress;

  if (counted?.step !== undefined) {
    return { suite: counted.step, done: counted.done, total: counted.total };
  }

  if (counted !== undefined && suites.length === 1) {
    return {
      suite: suites[0] as string,
      done: counted.done,
      total: counted.total,
    };
  }

  const stage = progress.note;

  return {
    suite: "",
    done: counted?.done ?? null,
    total: counted?.total ?? null,
    ...(stage === undefined ? {} : { stage }),
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

function runningMode(
  input: Pick<PanelInput, "scanning" | "runMode">,
  mode: FreshnessModel["action"]["mode"],
): FreshnessModel["action"]["mode"] {
  return input.scanning && input.runMode !== undefined
    ? { ...mode, value: input.runMode }
    : mode;
}

export function opensScanPanel(
  previous: string | null,
  current: string | null,
): boolean {
  return current === "scan" && previous !== "scan";
}
