export const SCAN_KEY = "scan";

export const ANALYSIS_KEY = "structure";

export const DESCRIBE_KEY = "describe";

export type ResultState =
  | { kind: "current"; at: number | null }
  | { kind: "out-of-date"; modules: string[] }
  | { kind: "never-run" }
  | { kind: "checking" }
  | { kind: "not-measured" }
  | { kind: "failed"; at: number | null }
  | { kind: "running"; done: number | null; total: number | null };

export type RunningResult = Extract<ResultState, { kind: "running" }>;

export type ResultSensor = {
  name: string;
  status: "ran" | "failed" | "off" | "stale" | "not run";
  modifiedMs?: number | null;
  commit?: string;
  modified?: boolean;
  refusal?: { at: number };
  measured?: object;
};

export type ResultInput = {
  scan: {
    scannedAt: number;
    changes: { files: readonly { path: string }[]; moved: unknown };
  } | null;
  sensors: readonly ResultSensor[];
  lines: { of: (id: string) => { kind: string } };
  describedAt: number | null;
  run: {
    running: readonly string[];
    failures: Readonly<Record<string, string>>;
    ranAt: Readonly<Record<string, number>>;
  };
  scanning: boolean;
  describeProgress?: { entries: number; total: number } | null;
  sensorProgress?: {
    name: string;
    progress?: { done: number; total: number };
  } | null;
  extracting?: boolean;
  freshness?: unknown;
  plan?: {
    view: { gaps: Readonly<Record<string, string[]>>; never: string[] };
    settled?: boolean;
  } | null;
  scansCommit?: { commit: string | null; modified: boolean };
  finishedInRun?: readonly string[];
};

function failureAt(
  key: string,
  input: ResultInput,
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

export function runningState(
  key: string,
  input: ResultInput,
): RunningResult | null {
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
  input: ResultInput,
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

function currentAt(key: string, input: ResultInput): number | null {
  const status = input.sensors.find((one) => one.name === key);

  return input.run.ranAt[key] ?? status?.modifiedMs ?? null;
}

export function sensorState(
  name: string,
  input: ResultInput,
  modules: string[],
  gaps: Map<string, string[]>,
): ResultState {
  const running = runningState(name, input);

  if (running !== null) {
    return running;
  }

  const failed = failureAt(name, input);

  if (failed !== null) {
    return { kind: "failed", at: failed.at };
  }

  if (input.finishedInRun?.includes(name) === true) {
    return { kind: "current", at: currentAt(name, input) };
  }

  const status = input.sensors.find((entry) => entry.name === name);
  const measured =
    status === undefined || status.status === "not run"
      ? null
      : (status.measured ?? {});

  if (input.freshness === undefined) {
    return measured === null
      ? { kind: "never-run" }
      : { kind: "current", at: currentAt(name, input) };
  }

  const answer = input.plan?.view;

  if (answer === undefined) {
    return { kind: "checking" };
  }

  if (answer.never.includes(name) === true) {
    if (input.plan?.settled === false) {
      return { kind: "checking" };
    }

    gaps.set(name, [...modules]);

    return { kind: "never-run" };
  }

  const gap = answer.gaps[name] ?? [];

  gaps.set(name, gap);

  return gap.length > 0
    ? { kind: "out-of-date", modules: gap }
    : { kind: "current", at: currentAt(name, input) };
}

export function describeState(
  input: ResultInput,
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

export function scanState(input: ResultInput, modules: string[]): ResultState {
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

export function analysisState(
  input: ResultInput,
  modules: string[],
): ResultState {
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

  if (status.commit === undefined || input.scansCommit === undefined) {
    return { kind: "current", at };
  }

  const { commit, modified } = input.scansCommit;

  if (status.commit === commit && status.modified === modified) {
    return { kind: "current", at };
  }

  const changed = structureChanged(input, modules);

  return {
    kind: "out-of-date",
    modules: changed.length > 0 ? changed : [...modules],
  };
}
