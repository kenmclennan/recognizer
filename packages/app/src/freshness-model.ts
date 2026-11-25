import { File, Repository } from "@recognizer/core";
import { type Freshness, sensorArmed, unregisteredMessage } from "recognizer";
import { ageText } from "./footer-scan";
import type { IconName } from "./icons";
import { DESCRIBE_KEY, type ResultsMode } from "./scan-freshness";
import {
  describerRegistered,
  type PanelInput,
  type RowSensor,
} from "./scan-panel-model";
import { isActive } from "./scan-run-model";
import { scansCommit } from "./scans-commit";
import type { SensorStatus } from "./sensor-run";

export { DESCRIBE_KEY };

export const SCAN_KEY = "scan";

export const ANALYSIS_KEY = "structure";

export type ResultState =
  | { kind: "current"; at: number | null }
  | { kind: "out-of-date"; modules: string[] }
  | { kind: "never-run" }
  | { kind: "checking" }
  | { kind: "failed"; at: number | null }
  | { kind: "running"; done: number | null; total: number | null };

export type ResultRow = {
  key: string;
  name: string;
  state: ResultState;
  tickable: boolean;
  scoped: boolean;
};

export type SummaryTone = "ok" | "warn" | "bad" | "run";

export type Summary = {
  shape:
    | "running"
    | "attention"
    | "changed"
    | "behind"
    | "checking"
    | "unregistered"
    | "current";
  tone: SummaryTone;
  icon: IconName;
  head: string;
  line: string;
  bar: { done: number; total: number } | null;
};

export type Action = {
  primary: { label: string; disabled: boolean };
  mode: { value: ResultsMode; disabled: boolean };
};

export type FindingsLine = {
  kind: "hidden" | "missing";
  text: string;
  link: string;
} | null;

export type NoResult = {
  sensor: string;
  reason: "excluded" | "unowned" | "unknown";
  modules: string[];
  languages?: string[];
};

export type FreshnessModel = {
  rows: ResultRow[];
  changed: string[];
  update: string[];
  noResult: NoResult[];
  summary: Summary;
  action: Action;
  findings: FindingsLine;
  group: (sensor: string) => "current" | "none-yet";
  isChanged: (moduleId: string) => boolean;
  footer: string | null;
  gaps: ReadonlyMap<string, string[]>;
  ticked: (key: string) => boolean;
  scopeCount: number;
  runModules: number;
  modules: ReadonlySet<string>;
  stale: ReadonlyMap<string, ReadonlySet<string>>;
};

export type Unregistered = { name: string; display: string };

export type StateText = { icon: IconName; text: string };

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function count(value: number): string {
  return value.toLocaleString("en-US");
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) {
    return names.join("");
  }

  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function stateText(state: ResultState, now: number): StateText {
  switch (state.kind) {
    case "current":
      return {
        icon: "circle-check",
        text:
          state.at === null ? "current" : `current, ${ageText(state.at, now)}`,
      };
    case "out-of-date":
      return {
        icon: "circle-alert",
        text: `${plural(state.modules.length, "file")} out of date`,
      };
    case "never-run":
      return { icon: "circle-dashed", text: "never run" };
    case "checking":
      return { icon: "circle-dashed", text: "checking" };
    case "failed":
      return {
        icon: "circle-x",
        text:
          state.at === null ? "failed" : `failed, ${ageText(state.at, now)}`,
      };
    case "running":
      return {
        icon: "loader",
        text:
          state.done !== null && state.total !== null
            ? `${count(state.done)} of ${count(state.total)}`
            : "running",
      };
  }
}

function isTicked(input: PanelInput, sensors: RowSensor[], key: string) {
  if (key === SCAN_KEY) {
    return true;
  }

  if (key === ANALYSIS_KEY) {
    return input.ticks.analysis;
  }

  if (key === DESCRIBE_KEY) {
    return input.ticks.describe;
  }

  const one = sensors.find(({ name }) => name === key);

  if (one?.runsTests === true) {
    return sensorArmed(input.ticks, one);
  }

  const plain = sensors
    .filter(({ runsTests }) => !runsTests)
    .map(({ name }) => name);

  return (input.ticks.ticked ?? plain).includes(key);
}

export function scopeModules(input: PanelInput): string[] {
  return input.ticks.onlyView && input.view
    ? input.view.modules
    : input.lines.modules;
}

function failureAt(
  key: string,
  input: PanelInput,
): { at: number | null } | null {
  const status = input.sensors.find((one) => one.name === key);

  if (input.run.failures[key] !== undefined) {
    return { at: input.run.ranAt[key] ?? null };
  }

  if (status?.refusal !== undefined) {
    return { at: status.modifiedMs ?? status.refusal.at ?? null };
  }

  if (status?.status === "failed") {
    return { at: status.modifiedMs ?? null };
  }

  return null;
}

function runningState(
  key: string,
  input: PanelInput,
): Extract<ResultState, { kind: "running" }> | null {
  if (!input.scanning) {
    return null;
  }

  if (key === SCAN_KEY) {
    return input.extracting === true
      ? { kind: "running", done: null, total: null }
      : null;
  }

  if (!input.run.running.includes(key)) {
    return null;
  }

  if (key === DESCRIBE_KEY && input.describeProgress != null) {
    return {
      kind: "running",
      done: input.describeProgress.entries,
      total: input.describeProgress.total,
    };
  }

  const reported = input.sensorProgress;

  if (
    reported != null &&
    reported.name === key &&
    reported.progress !== undefined
  ) {
    return {
      kind: "running",
      done: reported.progress.done,
      total: reported.progress.total,
    };
  }

  return { kind: "running", done: null, total: null };
}

export function structureChanged(
  input: PanelInput,
  modules: string[],
): string[] {
  if (input.scan === null) {
    return [];
  }

  const { files, moved } = input.scan.changes;

  if (moved !== null) {
    return [...modules];
  }

  const paths = new Set(files.map(({ path }) => path));

  return modules.filter((id) => paths.has(id));
}

function inScopeOrder(modules: string[], ids: Set<string>): string[] {
  return modules.filter((id) => ids.has(id));
}

function currentAt(key: string, input: PanelInput): number | null {
  const status = input.sensors.find((one) => one.name === key);

  return input.run.ranAt[key] ?? status?.modifiedMs ?? null;
}

function ranInThisRun(key: string, input: PanelInput): boolean {
  const snapshot = input.runView?.run ?? null;

  if (snapshot === null || !isActive(snapshot)) {
    return false;
  }

  return snapshot.plugins.some(
    (plugin) => plugin.name === key && plugin.state === "finished",
  );
}

function sensorState(
  one: RowSensor,
  input: PanelInput,
  modules: string[],
  gaps: Map<string, string[]>,
): ResultState {
  const running = runningState(one.name, input);

  if (running !== null) {
    return running;
  }

  const failed = failureAt(one.name, input);

  if (failed !== null) {
    return { kind: "failed", at: failed.at };
  }

  if (ranInThisRun(one.name, input)) {
    return { kind: "current", at: currentAt(one.name, input) };
  }

  const status = input.sensors.find((entry) => entry.name === one.name);
  const measured =
    status === undefined || status.status === "not run"
      ? null
      : (status.measured ?? {});

  if (input.freshness === undefined) {
    return measured === null
      ? { kind: "never-run" }
      : { kind: "current", at: currentAt(one.name, input) };
  }

  const answer = input.plan?.view;

  if (answer === undefined) {
    return { kind: "checking" };
  }

  if (answer.never.includes(one.name) === true) {
    gaps.set(one.name, [...modules]);

    return { kind: "never-run" };
  }

  const gap = answer.gaps[one.name] ?? [];

  gaps.set(one.name, gap);

  return gap.length > 0
    ? { kind: "out-of-date", modules: gap }
    : { kind: "current", at: currentAt(one.name, input) };
}

function describeState(
  input: PanelInput,
  modules: string[],
  gaps: Map<string, string[]>,
): ResultState {
  const running = runningState(DESCRIBE_KEY, input);

  if (running !== null) {
    return running;
  }

  const stale = input.plan?.view.gaps[DESCRIBE_KEY] ?? [];
  const planned = input.plan !== null && input.plan !== undefined;
  const described = modules.filter((id) => {
    const kind = input.lines.of(id).kind;

    return kind === "current" || kind === "out-of-date";
  }).length;

  gaps.set(DESCRIBE_KEY, stale);

  if (input.run.failures[DESCRIBE_KEY] !== undefined) {
    return { kind: "failed", at: input.run.ranAt[DESCRIBE_KEY] ?? null };
  }

  if (described === 0) {
    return { kind: "never-run" };
  }

  if (!planned) {
    return { kind: "checking" };
  }

  if (stale.length > 0) {
    return { kind: "out-of-date", modules: stale };
  }

  return {
    kind: "current",
    at: input.run.ranAt[DESCRIBE_KEY] ?? input.describedAt,
  };
}

function scanState(input: PanelInput, modules: string[]): ResultState {
  const running = runningState(SCAN_KEY, input);

  if (running !== null) {
    return running;
  }

  if (input.scan === null) {
    return { kind: "never-run" };
  }

  const changed = structureChanged(input, modules);

  return changed.length > 0
    ? { kind: "out-of-date", modules: changed }
    : { kind: "current", at: input.scan.scannedAt };
}

function analysisState(input: PanelInput, modules: string[]): ResultState {
  const running = runningState(ANALYSIS_KEY, input);

  if (running !== null) {
    return running;
  }

  const failed = failureAt(ANALYSIS_KEY, input);

  if (failed !== null) {
    return { kind: "failed", at: failed.at };
  }

  const status = input.sensors.find(({ name }) => name === ANALYSIS_KEY);

  if (
    status === undefined ||
    status.status === "off" ||
    status.status === "not run" ||
    (input.scan === null && status.commit === undefined)
  ) {
    return { kind: "never-run" };
  }

  const at =
    input.run.ranAt[ANALYSIS_KEY] ??
    status.modifiedMs ??
    input.scan?.scannedAt ??
    null;

  if (input.plan === null || input.plan === undefined) {
    return { kind: "checking" };
  }

  if (status.commit === undefined || input.scans === undefined) {
    return { kind: "current", at };
  }

  const { commit, modified } = scansCommit(input.scans);

  if (status.commit === commit && status.modified === modified) {
    return { kind: "current", at };
  }

  const changed = structureChanged(input, modules);

  return {
    kind: "out-of-date",
    modules: changed.length > 0 ? changed : [...modules],
  };
}

function shortModule(id: string): string {
  return File.nameOf(id);
}

function changedList(ids: string[]): string {
  const shown = ids.slice(0, 3).map(shortModule);
  const more = ids.length - shown.length;

  return more > 0 ? `${shown.join(", ")} and ${more} more` : joinNames(shown);
}

function unitOf(key: string): string {
  return key === DESCRIBE_KEY ? "files" : "functions";
}

function summarize(
  input: PanelInput,
  rows: ResultRow[],
  changed: string[],
  ticked: (key: string) => boolean,
  scopeCount: number,
  runModules: number,
  noResult: NoResult[],
  nothingToRun: Unregistered[],
): Summary {
  const running = rows.filter(({ state }) => state.kind === "running");

  if (input.scanning && running.length > 0) {
    const names = joinNames(running.map(({ name }) => name));
    const counted = running.find(
      ({ state }) =>
        state.kind === "running" && state.done !== null && state.total !== null,
    );
    const state = counted?.state;
    const others = rows.filter(
      ({ state: other }) =>
        other.kind !== "running" && other.kind !== "current",
    );
    const tail = others.length === 0 ? " Everything else is current." : "";
    const modules = runModules > 0 ? runModules : scopeCount;

    if (counted !== undefined && state?.kind === "running") {
      const done = state.done ?? 0;
      const total = state.total ?? 0;

      return {
        shape: "running",
        tone: "run",
        icon: "loader",
        head: `Running ${names} on ${plural(modules, "file")}`,
        line: `${count(done)} of ${count(total)} ${unitOf(counted.key)}.${tail}`,
        bar: { done, total },
      };
    }

    return {
      shape: "running",
      tone: "run",
      icon: "loader",
      head: `Running ${names} on ${plural(modules, "file")}`,
      line: `Working on it.${tail}`,
      bar: null,
    };
  }

  if (input.scanning) {
    const modules = runModules > 0 ? runModules : scopeCount;

    return {
      shape: "running",
      tone: "run",
      icon: "loader",
      head: `Updating ${plural(modules, "file")}`,
      line: "Working on it.",
      bar: null,
    };
  }

  if (input.plan === null || input.plan === undefined) {
    return {
      shape: "checking",
      tone: "run",
      icon: "circle-dashed",
      head: "Checking what is out of date",
      line: "Results show here once the check answers.",
      bar: null,
    };
  }

  const failed = rows.filter(({ state }) => state.kind === "failed");
  const never = rows.filter(({ state }) => state.kind === "never-run");
  const noResultSentence = noResult
    .map(({ sensor, reason, modules, languages }) => {
      const single = modules.length === 1;

      if (reason === "unknown") {
        return ` ${sensor} has no result for ${changedList(modules)}: no installed scanner publishes rules for ${joinNames(languages ?? [])}, so ${single ? "its" : "their"} test-file, supertype and private-import findings are unknown, not clean.`;
      }

      if (reason === "unowned") {
        return ` ${sensor} has no result for ${changedList(modules)}: no test suite in .recognizer/config.yaml covers ${single ? "it" : "them"}.`;
      }

      return single
        ? ` ${sensor} has no result for ${changedList(modules)}: its suite's coverage report does not include it.`
        : ` ${sensor} has no result for ${changedList(modules)}: their suites' coverage reports do not include them.`;
    })
    .join("");
  const tickedBehind = rows.filter(
    ({ key, state }) =>
      key !== SCAN_KEY && ticked(key) && state.kind === "out-of-date",
  );
  const behind = rows.filter(
    ({ key, state }) =>
      key !== SCAN_KEY && !ticked(key) && state.kind === "out-of-date",
  );
  const behindSentence =
    behind.length === 0
      ? ""
      : ` ${joinNames(behind.map(({ name }) => name))} ${behind.length === 1 ? "is" : "are"} out of date and not ticked.`;
  const current = rows.filter(({ state }) => state.kind === "current");
  const currentSentence =
    current.length === 0
      ? ""
      : ` ${joinNames(current.map(({ name }) => name))} ${current.length === 1 ? "is" : "are"} current.`;

  if (failed.length > 0 || never.length > 0) {
    const clauses = [
      ...(failed.length > 0
        ? [`${joinNames(failed.map(({ name }) => name))} failed`]
        : []),
      ...(never.length > 0
        ? [
            `${joinNames(never.map(({ name }) => name))} ${never.length === 1 ? "has" : "have"} never run`,
          ]
        : []),
    ];

    return {
      shape: "attention",
      tone: failed.length > 0 ? "bad" : "warn",
      icon: failed.length > 0 ? "circle-x" : "circle-dashed",
      head: clauses.join("; "),
      line: `Their values and findings are missing.${currentSentence}${behindSentence}${noResultSentence}`,
      bar: null,
    };
  }

  if (changed.length > 0) {
    return {
      shape: "changed",
      tone: "warn",
      icon: "circle-alert",
      head: `${plural(changed.length, "file")} changed since ${changed.length === 1 ? "it was" : "they were"} scanned`,
      line: `${changed.length === 1 ? "Its" : "Their"} bars, descriptions and findings are hidden until updated. ${changedList(changed)}.${behindSentence}${noResultSentence}`,
      bar: null,
    };
  }

  const lagging = tickedBehind.length > 0 ? tickedBehind : behind;

  if (lagging.length > 0) {
    return {
      shape: "behind",
      tone: "warn",
      icon: "circle-alert",
      head: lagging
        .map(({ name, state }) =>
          state.kind === "out-of-date"
            ? `${name} is out of date on ${plural(state.modules.length, "file")}`
            : name,
        )
        .join("; "),
      line: `Update ${joinNames(lagging.map(({ name }) => name))} to bring ${lagging.length === 1 ? "it" : "them"} up to date.${currentSentence}${noResultSentence}`,
      bar: null,
    };
  }

  if (nothingToRun.length > 0) {
    return {
      shape: "unregistered",
      tone: "warn",
      icon: "circle-dashed",
      head: "Nothing to run",
      line: nothingToRun.map(({ name }) => unregisteredMessage(name)).join(" "),
      bar: null,
    };
  }

  const whole = !(input.ticks.onlyView && input.view);

  return {
    shape: "current",
    tone: "ok",
    icon: "circle-check",
    head: `Everything on ${whole ? "the repository" : "this canvas"} is current`,
    line: `Scanned and measured since the last change to ${scopeCount === 1 ? "this file" : `these ${scopeCount} files`}.${noResultSentence}`,
    bar: null,
  };
}

function awaitingPlan(action: Action, input: PanelInput): Action {
  return input.plan?.settled === true
    ? action
    : { ...action, primary: { ...action.primary, disabled: true } };
}

function actionOf(
  input: PanelInput,
  rows: ResultRow[],
  update: string[],
  ticked: (key: string) => boolean,
  scopeCount: number,
  nothingToRun: Unregistered[],
): Action {
  const rescan = (input.mode ?? "bring") === "rescan";
  const mode = {
    value: (rescan ? "rescan" : "bring") as ResultsMode,
    disabled: input.scanning,
  };

  if (input.scanning) {
    return { primary: { label: "Running", disabled: true }, mode };
  }

  if (rescan) {
    return {
      primary: {
        label: `Rescan ${plural(scopeCount, "file")}`,
        disabled: false,
      },
      mode,
    };
  }

  if (update.length > 0) {
    return {
      primary: {
        label: `Update ${plural(update.length, "file")}`,
        disabled: false,
      },
      mode,
    };
  }

  const runnable = rows.filter(
    ({ key, state }) =>
      ticked(key) && (state.kind === "never-run" || state.kind === "failed"),
  );

  if (runnable.length > 0) {
    const named = runnable.filter(({ key }) => key !== SCAN_KEY);

    return {
      primary: {
        label:
          named.length === runnable.length
            ? `Run ${joinNames(named.map(({ name }) => name))}`
            : "Run",
        disabled: false,
      },
      mode,
    };
  }

  const untickedStale = rows.filter(
    ({ key, state }) =>
      key !== SCAN_KEY &&
      !ticked(key) &&
      (state.kind === "out-of-date" ||
        state.kind === "failed" ||
        state.kind === "never-run"),
  );

  if (untickedStale.length > 0) {
    return {
      primary: { label: "Nothing ticked to run", disabled: true },
      mode,
    };
  }

  if (input.plan === null || input.plan === undefined) {
    return { primary: { label: "Checking", disabled: true }, mode };
  }

  if (nothingToRun.length > 0) {
    return { primary: { label: "Nothing to run", disabled: true }, mode };
  }

  return { primary: { label: "Up to date", disabled: true }, mode };
}

export function findingsActionOf(
  primary: Action["primary"],
  link: string,
): { label: string; openScan: boolean } {
  const openScan = primary.disabled;

  return { label: openScan ? "Open Scan" : link, openScan };
}

export function hiddenText(count: number, whole: boolean): string {
  return `Findings for ${plural(count, "changed file")} ${count === 1 ? "is" : "are"} hidden${whole ? "" : " on this canvas"}.`;
}

function findingsLine(
  rows: ResultRow[],
  changed: string[],
  whole: boolean,
): FindingsLine {
  if (changed.length > 0) {
    return {
      kind: "hidden",
      text: hiddenText(changed.length, whole),
      link: "Update them",
    };
  }

  const sensors = rows.filter(
    ({ key }) => key !== SCAN_KEY && key !== DESCRIBE_KEY,
  );
  const failed = sensors.filter(({ state }) => state.kind === "failed");
  const never = sensors.filter(({ state }) => state.kind === "never-run");

  if (failed.length === 0 && never.length === 0) {
    return null;
  }

  const why = [
    ...(failed.length > 0 ? [`${failed.length} failed`] : []),
    ...(never.length > 0
      ? [`${never.length} ${never.length === 1 ? "has" : "have"} never run`]
      : []),
  ];
  const names = joinNames([...failed, ...never].map(({ name }) => name));

  return {
    kind: "missing",
    text: `No ${names} findings: ${why.join(", ")}.`,
    link: "Run them",
  };
}

function staleOf(
  modules: readonly string[],
  measured: NonNullable<SensorStatus["measured"]>,
  freshness: Freshness,
): Set<string> {
  if (!freshness.valid(measured)) {
    return new Set(modules);
  }

  return new Set(modules.filter((id) => !freshness.current(measured, id)));
}

function staleBySensor(
  input: PanelInput,
  sensors: RowSensor[],
): Map<string, ReadonlySet<string>> {
  const stale = new Map<string, ReadonlySet<string>>();

  if (input.freshness === undefined) {
    return stale;
  }

  for (const one of sensors) {
    const measured = input.sensors.find(
      (entry) => entry.name === one.name,
    )?.measured;

    if (measured !== undefined) {
      stale.set(
        one.name,
        staleOf(input.lines.modules, measured, input.freshness),
      );
    }
  }

  return stale;
}

function noResultOf(
  input: PanelInput,
  sensors: RowSensor[],
  rows: ResultRow[],
  modules: string[],
): NoResult[] {
  const hashes = (input.scans ?? Repository.empty).scannedHashes();
  const inScope = new Set(modules);
  const found: NoResult[] = [];

  const structureState = rows.find(({ key }) => key === ANALYSIS_KEY)?.state;
  const unknown = input.sensors.find(
    ({ name }) => name === ANALYSIS_KEY,
  )?.unknownFiles;

  if (
    unknown !== undefined &&
    (structureState?.kind === "current" ||
      structureState?.kind === "out-of-date")
  ) {
    const gap = new Set(
      structureState.kind === "out-of-date" ? structureState.modules : [],
    );
    const named = unknown.files.filter(
      (id) => inScope.has(id) && hashes.has(id) && !gap.has(id),
    );

    if (named.length > 0) {
      const namedLanguages = new Set(
        (input.scans ?? Repository.empty).files
          .filter((file) => named.includes(file.path))
          .map((file) => file.language),
      );

      found.push({
        sensor: "Structural analysis",
        reason: "unknown",
        modules: inScopeOrder(modules, new Set(named)),
        languages: unknown.languages.filter((language) =>
          namedLanguages.has(language),
        ),
      });
    }
  }

  for (const one of sensors) {
    const status = input.sensors.find((entry) => entry.name === one.name);
    const state = rows.find(({ key }) => key === one.name)?.state;

    if (state?.kind !== "current" && state?.kind !== "out-of-date") {
      continue;
    }

    const gap = new Set(state.kind === "out-of-date" ? state.modules : []);

    for (const reason of ["excluded", "unowned"] as const) {
      const listed = status?.[reason];

      if (listed === undefined) {
        continue;
      }

      const named = listed.files.filter(
        (id) => inScope.has(id) && hashes.has(id) && !gap.has(id),
      );

      if (named.length > 0) {
        found.push({
          sensor: one.display,
          reason,
          modules: inScopeOrder(modules, new Set(named)),
        });
      }
    }
  }

  return found;
}

export function buildFreshnessModel(
  input: PanelInput,
  sensors: RowSensor[],
): FreshnessModel {
  const modules = scopeModules(input);
  const gaps = new Map<string, string[]>();
  const rows: ResultRow[] = [
    {
      key: SCAN_KEY,
      name: "Structure",
      state: scanState(input, modules),
      tickable: false,
      scoped: false,
    },
    {
      key: ANALYSIS_KEY,
      name: "Structural analysis",
      state: analysisState(input, modules),
      tickable: true,
      scoped: false,
    },
    ...(describerRegistered(input.config)
      ? [
          {
            key: DESCRIBE_KEY,
            name: "Descriptions",
            state: describeState(input, modules, gaps),
            tickable: true,
            scoped: false,
          },
        ]
      : []),
    ...sensors
      .filter((one) => one.registered)
      .map((one) => ({
        key: one.name,
        name: one.display,
        state: sensorState(one, input, modules, gaps),
        tickable: true,
        scoped: one.scoped,
      })),
  ];
  const ticked = (key: string) => isTicked(input, sensors, key);
  const structure = rows[0]?.state;
  const structureIds =
    structure?.kind === "out-of-date" ? structure.modules : [];
  const wanted = new Set(structureIds);

  for (const row of rows.slice(1)) {
    if (ticked(row.key) && row.state.kind === "out-of-date") {
      for (const id of row.state.modules) {
        wanted.add(id);
      }
    }
  }

  const update = inScopeOrder(modules, wanted);
  const structureSet = new Set(structureIds);
  const sensorKind = new Map(rows.map(({ key, state }) => [key, state.kind]));
  const changed = inScopeOrder(modules, structureSet);
  const noResult = noResultOf(input, sensors, rows, modules);
  const runModules = input.runModules ?? 0;
  const whole = !(input.ticks.onlyView && input.view);
  const nothingToRun = sensors.some(({ registered }) => registered)
    ? []
    : sensors
        .filter(({ registered }) => !registered)
        .map(({ name, display }) => ({ name, display }));

  return {
    rows,
    changed,
    update,
    noResult,
    summary: summarize(
      input,
      rows.filter(
        ({ key, tickable }) =>
          key === DESCRIBE_KEY || key === SCAN_KEY || tickable,
      ),
      changed,
      ticked,
      modules.length,
      runModules,
      noResult,
      nothingToRun,
    ),
    action: awaitingPlan(
      actionOf(input, rows, update, ticked, modules.length, nothingToRun),
      input,
    ),
    findings: findingsLine(rows, changed, whole),
    group: (sensor) => {
      const kind = sensorKind.get(sensor);

      return kind === "never-run" || kind === "failed" ? "none-yet" : "current";
    },
    isChanged: (id) => structureSet.has(id),
    footer: input.scanning ? (input.progressText ?? "Scanning…") : null,
    gaps,
    ticked,
    scopeCount: modules.length,
    runModules,
    modules: new Set(input.lines.modules),
    stale: staleBySensor(input, sensors),
  };
}
