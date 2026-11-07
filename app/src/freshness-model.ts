import { ageText } from "./footer-scan";
import type { IconName } from "./icons";
import {
  DESCRIBE_KEY,
  freshnessScope,
  gapOf,
  MUTATION_KEY,
  type ResultsMode,
  sensorFreshness,
} from "./scan-freshness";
import type { PanelInput, RowSensor } from "./scan-panel-model";

export { DESCRIBE_KEY, MUTATION_KEY };

export const STRUCTURE_KEY = "structure";

export type ResultState =
  | { kind: "current"; at: number | null }
  | { kind: "out-of-date"; modules: string[] }
  | { kind: "never-run" }
  | { kind: "failed"; at: number | null }
  | { kind: "running"; done: number | null; total: number | null };

export type ResultRow = {
  key: string;
  name: string;
  state: ResultState;
  tickable: boolean;
};

export type SummaryTone = "ok" | "warn" | "bad" | "run";

export type Summary = {
  shape: "running" | "attention" | "changed" | "current";
  tone: SummaryTone;
  icon: IconName;
  head: string;
  line: string;
  bar: { done: number; total: number } | null;
};

export type Action = {
  primary: { label: string; disabled: boolean };
  secondary: { label: string; mode: ResultsMode; disabled: boolean };
};

export type FindingsLine = {
  kind: "hidden" | "missing";
  text: string;
  link: string;
} | null;

export type FreshnessModel = {
  rows: ResultRow[];
  changed: string[];
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
};

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
        text: `${plural(state.modules.length, "module")} out of date`,
      };
    case "never-run":
      return { icon: "circle-dashed", text: "never run" };
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
  if (key === STRUCTURE_KEY) {
    return true;
  }

  if (key === DESCRIBE_KEY) {
    return input.ticks.describe;
  }

  const one = sensors.find(({ name }) => name === key);

  if (one?.runsTests === true) {
    return input.ticks.once.includes(key);
  }

  const plain = sensors
    .filter(({ runsTests }) => !runsTests)
    .map(({ name }) => name);

  return (input.ticks.ticked ?? plain).includes(key);
}

function scopeModules(input: PanelInput): string[] {
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

  if (key === STRUCTURE_KEY) {
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
    reported.step === "mutants"
  ) {
    return { kind: "running", done: reported.done, total: reported.total };
  }

  return { kind: "running", done: null, total: null };
}

function structureChanged(input: PanelInput, modules: string[]): string[] {
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

function describeGap(input: PanelInput, modules: string[]) {
  const stale: string[] = [];
  let described = 0;

  for (const id of modules) {
    const kind = input.lines.of(id).kind;

    if (kind === "current" || kind === "out-of-date") {
      described += 1;
    }

    if (kind === "out-of-date" || kind === "missing") {
      stale.push(id);
    }
  }

  return { stale, described };
}

function currentAt(key: string, input: PanelInput): number | null {
  const status = input.sensors.find((one) => one.name === key);

  return input.run.ranAt[key] ?? status?.modifiedMs ?? null;
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

  const scope = freshnessScope(modules, input.scans ?? [], input.freshness);
  const result = sensorFreshness(scope, measured, one.name === MUTATION_KEY);

  if (result.kind === "never-run") {
    gaps.set(one.name, [...modules]);

    return { kind: "never-run" };
  }

  const gap = gapOf(result, modules);

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

  const { stale, described } = describeGap(input, modules);

  gaps.set(DESCRIBE_KEY, stale);

  if (input.run.failures[DESCRIBE_KEY] !== undefined) {
    return { kind: "failed", at: input.run.ranAt[DESCRIBE_KEY] ?? null };
  }

  if (described === 0) {
    return { kind: "never-run" };
  }

  if (stale.length > 0) {
    return { kind: "out-of-date", modules: stale };
  }

  return {
    kind: "current",
    at: input.run.ranAt[DESCRIBE_KEY] ?? input.describedAt,
  };
}

function structureState(input: PanelInput, modules: string[]): ResultState {
  const running = runningState(STRUCTURE_KEY, input);

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

function shortModule(id: string): string {
  return id.split("/").pop() ?? id;
}

function changedList(ids: string[]): string {
  const shown = ids.slice(0, 3).map(shortModule);
  const more = ids.length - shown.length;

  return more > 0 ? `${shown.join(", ")} and ${more} more` : joinNames(shown);
}

function unitOf(key: string): string {
  return key === DESCRIBE_KEY ? "modules" : "functions";
}

function summarize(
  input: PanelInput,
  rows: ResultRow[],
  changed: string[],
  ticked: (key: string) => boolean,
  scopeCount: number,
  runModules: number,
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
        head: `Running ${names} on ${plural(modules, "module")}`,
        line: `${count(done)} of ${count(total)} ${unitOf(counted.key)}.${tail}`,
        bar: { done, total },
      };
    }

    return {
      shape: "running",
      tone: "run",
      icon: "loader",
      head: `Running ${names} on ${plural(modules, "module")}`,
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
      head: `Updating ${plural(modules, "module")}`,
      line: "Working on it.",
      bar: null,
    };
  }

  const failed = rows.filter(
    ({ key, state }) => ticked(key) && state.kind === "failed",
  );
  const never = rows.filter(
    ({ key, state }) => ticked(key) && state.kind === "never-run",
  );

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
    const current = rows.filter(({ state }) => state.kind === "current");
    const currentSentence =
      current.length === 0
        ? ""
        : ` ${joinNames(current.map(({ name }) => name))} ${current.length === 1 ? "is" : "are"} current.`;

    return {
      shape: "attention",
      tone: failed.length > 0 ? "bad" : "warn",
      icon: failed.length > 0 ? "circle-x" : "circle-dashed",
      head: clauses.join("; "),
      line: `Their values and findings are missing.${currentSentence}`,
      bar: null,
    };
  }

  if (changed.length > 0) {
    return {
      shape: "changed",
      tone: "warn",
      icon: "circle-alert",
      head: `${plural(changed.length, "module")} changed since ${changed.length === 1 ? "it was" : "they were"} scanned`,
      line: `${changed.length === 1 ? "Its" : "Their"} bars, descriptions and findings are hidden until updated. ${changedList(changed)}.`,
      bar: null,
    };
  }

  const whole = !(input.ticks.onlyView && input.view);

  return {
    shape: "current",
    tone: "ok",
    icon: "circle-check",
    head: `Everything on ${whole ? "the repository" : "this canvas"} is current`,
    line: `Scanned and measured since the last change to ${scopeCount === 1 ? "this module" : `these ${scopeCount} modules`}.`,
    bar: null,
  };
}

function actionOf(
  input: PanelInput,
  rows: ResultRow[],
  changed: string[],
  ticked: (key: string) => boolean,
  scopeCount: number,
): Action {
  const rescan = (input.mode ?? "bring") === "rescan";
  const secondary = {
    label: rescan ? "Update only what changed" : "Rescan from scratch",
    mode: (rescan ? "bring" : "rescan") as ResultsMode,
    disabled: input.scanning,
  };

  if (input.scanning) {
    return { primary: { label: "Running", disabled: true }, secondary };
  }

  if (rescan) {
    return {
      primary: {
        label: `Rescan ${plural(scopeCount, "module")}`,
        disabled: false,
      },
      secondary,
    };
  }

  if (changed.length > 0) {
    return {
      primary: {
        label: `Update ${plural(changed.length, "module")}`,
        disabled: false,
      },
      secondary,
    };
  }

  const runnable = rows.filter(
    ({ key, state }) =>
      ticked(key) && (state.kind === "never-run" || state.kind === "failed"),
  );

  if (runnable.length > 0) {
    return {
      primary: {
        label: `Run ${joinNames(runnable.map(({ name }) => name))}`,
        disabled: false,
      },
      secondary,
    };
  }

  return { primary: { label: "Up to date", disabled: true }, secondary };
}

export function hiddenText(count: number, whole: boolean): string {
  return `Findings for ${plural(count, "changed module")} ${count === 1 ? "is" : "are"} hidden${whole ? "" : " on this canvas"}.`;
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
    ({ key }) => key !== STRUCTURE_KEY && key !== DESCRIBE_KEY,
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

export function buildFreshnessModel(
  input: PanelInput,
  sensors: RowSensor[],
): FreshnessModel {
  const modules = scopeModules(input);
  const gaps = new Map<string, string[]>();
  const rows: ResultRow[] = [
    {
      key: STRUCTURE_KEY,
      name: "Structure",
      state: structureState(input, modules),
      tickable: false,
    },
    {
      key: DESCRIBE_KEY,
      name: "Descriptions",
      state: describeState(input, modules, gaps),
      tickable: true,
    },
    ...sensors.map((one) => ({
      key: one.name,
      name: one.display,
      state: sensorState(one, input, modules, gaps),
      tickable: true,
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

  const changed = inScopeOrder(modules, wanted);
  const structureSet = new Set(structureIds);
  const sensorKind = new Map(rows.map(({ key, state }) => [key, state.kind]));
  const runModules = input.runModules ?? 0;
  const whole = !(input.ticks.onlyView && input.view);

  return {
    rows,
    changed,
    summary: summarize(
      input,
      rows,
      changed,
      ticked,
      modules.length,
      runModules,
    ),
    action: actionOf(input, rows, changed, ticked, modules.length),
    findings: findingsLine(rows, inScopeOrder(modules, structureSet), whole),
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
  };
}
