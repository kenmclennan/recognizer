import type {
  DescribeAsk,
  DescribeHalt,
  Diagnosis,
  PluginRunView,
  RunView,
} from "@recognizer/core";
import { roundedTime } from "./estimate-text";

export type PluginCount = {
  done: number;
  total: number;
  unit: string;
  step?: string;
};

export type PluginProgress = {
  name: string;
  phase: "extract" | "describe" | "sense";
  progress?: PluginCount;
  note?: string;
};

export type EntryResult = {
  name: string;
  outcome: "ok" | "failed" | "stopped";
  reason: string | null;
  diagnosis: Diagnosis | null;
};

export type PhaseProgress = { total: number; entries: EntryResult[] };

export type DescribeCount = {
  total: number;
  done: number;
  failed: number;
  firstFailure: { item: string; reason: string } | null;
};

export type ScanTiming = {
  extractAt: Record<string, number>;
  extractDoneAt: Record<string, number>;
  extractTotals: Record<string, number>;
};

export type RunProgress = {
  extract: "pending" | "run" | "current";
  languages: string[] | null;
  extractEntries: EntryResult[];
  extractEstimateMs: number | null;
  describe: DescribeCount | null;
  describeStop: DescribeHalt | null;
  describeAsk: DescribeAsk | null;
  describeSkipped: boolean;
  sense: PhaseProgress | null;
  sensorProgress: PluginProgress | null;
  extractSettled: boolean;
  done: boolean;
  stopped: boolean;
  sensing: string | null;
  log: string | null;
  timing: ScanTiming;
};

export type ProgressOverlay = {
  extractSettled: boolean;
  done: boolean;
  stopped: boolean;
};

export type ShowTarget =
  | { kind: "sensor"; name: string; reason: string }
  | { kind: "module"; id: string; reason: string };

export const NO_TIMING: ScanTiming = {
  extractAt: {},
  extractDoneAt: {},
  extractTotals: {},
};

export const NO_OVERLAY: ProgressOverlay = {
  extractSettled: false,
  done: false,
  stopped: false,
};

export const NO_PROGRESS: RunProgress = {
  extract: "pending",
  languages: null,
  extractEntries: [],
  extractEstimateMs: null,
  describe: null,
  describeStop: null,
  describeAsk: null,
  describeSkipped: false,
  sense: null,
  sensorProgress: null,
  extractSettled: false,
  done: false,
  stopped: false,
  sensing: null,
  log: null,
  timing: NO_TIMING,
};

export function began(plugin: PluginRunView): boolean {
  return (
    plugin.state === "running" ||
    plugin.state === "finished" ||
    plugin.state === "failed" ||
    (plugin.state === "stopped" &&
      (plugin.progress !== null || plugin.stage !== null))
  );
}

function entryOf(plugin: PluginRunView): EntryResult {
  return {
    name: plugin.name,
    outcome:
      plugin.state === "finished"
        ? "ok"
        : plugin.state === "stopped"
          ? "stopped"
          : "failed",
    reason: plugin.failure?.reason ?? null,
    diagnosis: plugin.failure?.diagnosis ?? null,
  };
}

function ended(plugin: PluginRunView): boolean {
  return (
    plugin.state === "finished" ||
    plugin.state === "failed" ||
    plugin.state === "stopped"
  );
}

function describeOf(plugin: PluginRunView | undefined): DescribeCount | null {
  if (plugin === undefined || !began(plugin)) {
    return null;
  }

  return {
    total: plugin.progress?.total ?? 0,
    done: plugin.progress?.done ?? 0,
    failed: plugin.tally?.failed ?? 0,
    firstFailure: plugin.tally?.firstFailure ?? null,
  };
}

function sensorProgressOf(
  plugins: readonly PluginRunView[],
): PluginProgress | null {
  const running = plugins.find(
    (one) => one.state === "running" && one.phase !== "describe",
  );

  if (running === undefined) {
    return null;
  }

  return {
    name: running.name,
    phase: running.phase,
    ...(running.progress === null
      ? {}
      : {
          progress: {
            done: running.progress.done,
            total: running.progress.total,
            unit: running.progress.unit,
          },
        }),
  };
}

export function progressOfRun(
  run: RunView | null,
  timing: ScanTiming = NO_TIMING,
  overlay: ProgressOverlay = NO_OVERLAY,
): RunProgress {
  if (run === null) {
    return { ...NO_PROGRESS, ...overlay, timing };
  }

  const extracts = run.plugins.filter((one) => one.phase === "extract");
  const senses = run.plugins.filter((one) => one.phase === "sense");
  const describing = run.plugins.find((one) => one.phase === "describe");
  const active = run.state === "checking" || run.state === "running";
  const finished = run.state === "finished" || run.state === "failed";
  const settled =
    overlay.extractSettled ||
    finished ||
    run.log !== null ||
    (describing !== undefined && began(describing)) ||
    senses.some(began);
  const begun =
    run.plugins.some(began) || run.structure !== null || run.log !== null;
  const confirmation = run.confirmation;

  return {
    extract:
      extracts.length > 0
        ? settled
          ? "current"
          : "run"
        : settled
          ? "current"
          : begun
            ? "current"
            : "pending",
    languages: extracts.length > 0 ? extracts.map((one) => one.name) : null,
    extractEntries: extracts.filter(ended).map(entryOf),
    extractEstimateMs:
      extracts.find((one) => one.state === "running")?.estimateMs ?? null,
    describe: describeOf(describing),
    describeStop: run.describeHalt,
    describeAsk:
      !overlay.stopped && confirmation !== null && confirmation.answer === null
        ? confirmation.ask
        : null,
    describeSkipped: confirmation?.answer === "skip",
    sense: senses.some(began)
      ? { total: senses.length, entries: senses.filter(ended).map(entryOf) }
      : null,
    sensorProgress: sensorProgressOf(run.plugins),
    extractSettled: settled,
    done: overlay.done || (!active && run.state !== "stopped"),
    stopped: overlay.stopped || run.state === "stopped",
    sensing: senses.find((one) => one.state === "running")?.name ?? null,
    log: run.log,
    timing,
  };
}

export function stampTiming(
  timing: ScanTiming,
  after: RunView,
  at: number,
): ScanTiming {
  let next = timing;

  for (const plugin of after.plugins) {
    if (plugin.phase !== "extract" || !began(plugin)) {
      continue;
    }

    const { name } = plugin;

    if (!(name in next.extractAt)) {
      next = { ...next, extractAt: { ...next.extractAt, [name]: at } };
    }

    if (plugin.progress !== null && !(name in next.extractTotals)) {
      next = {
        ...next,
        extractTotals: { ...next.extractTotals, [name]: plugin.progress.total },
      };
    }

    if (ended(plugin) && !(name in next.extractDoneAt)) {
      next = { ...next, extractDoneAt: { ...next.extractDoneAt, [name]: at } };
    }
  }

  return next;
}

export function tokensText(tokens: number): string {
  if (tokens < 1000) {
    return String(tokens);
  }

  if (tokens < 1_000_000) {
    return `${Math.round(tokens / 1000)}K`;
  }

  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

export type DescribeAskText = {
  heading: string;
  model: string;
  estimate: string;
};

export function describeAskText(
  ask: DescribeAsk,
  rateMs: number | null = null,
): DescribeAskText {
  const tokens = `About ${tokensText(ask.inputTokens)} tokens`;

  return {
    heading: `Describe ${count(ask.modules)} files?`,
    model: `Model: ${ask.model}`,
    estimate:
      (ask.costUsd === null
        ? `${tokens}, price unknown`
        : `${tokens}, $${ask.costUsd.toFixed(2)} at API prices`) +
      (rateMs === null ? "" : `, ${roundedTime(ask.modules * rateMs)}`),
  };
}

function failures(entries: EntryResult[]): EntryResult[] {
  return entries.filter((entry) => entry.outcome === "failed");
}

const DESCRIBE_PHASE_KEY = "describe";

function count(value: number): string {
  return value.toLocaleString("en-US");
}

export function describeStopText(stop: DescribeHalt): string {
  const counts = `${count(stop.described)} described, ${count(stop.notDescribed)} not described. The next scan describes the rest.`;

  if (stop.cause === "failures") {
    const last = stop.reason === "" ? "" : ` (last: ${stop.reason})`;

    return `Stopped: ${stop.threshold} describing calls failed in a row${last}. ${counts}`;
  }

  const reason = stop.reason === "" ? "" : `: ${stop.reason}`;

  return `Stopped: Claude usage limit reached${reason}. ${counts}`;
}

export type RunRow = { key: string; display: string };

export type ScanningLine = { text: string; plugin: boolean };

export function scanningText(
  rows: readonly RunRow[],
  started: string | null,
  progress: RunProgress,
): string | null {
  return scanningLine(rows, started, progress)?.text ?? null;
}

export function scanningLine(
  rows: readonly RunRow[],
  started: string | null,
  progress: RunProgress,
): ScanningLine | null {
  if (progress.done || progress.stopped) {
    return null;
  }

  if (progress.describeAsk !== null) {
    return { text: "Waiting for your answer", plugin: false };
  }

  if (started === DESCRIBE_PHASE_KEY) {
    const describe = progress.describe;

    return {
      text:
        describe === null
          ? "Scanning\u2026"
          : `Describing\u2026 ${describe.done} of ${describe.total} files`,
      plugin: false,
    };
  }

  const sensors = rows.filter((row) => row.key !== DESCRIBE_PHASE_KEY);
  const at = sensors.findIndex((row) => row.key === started);
  const row = sensors[at];
  const reported = progress.sensorProgress;

  if (row === undefined) {
    const extracting =
      reported !== null && reported.phase === "extract"
        ? pluginText(capitalised(reported.name), reported)
        : null;

    return extracting === null
      ? { text: "Scanning\u2026", plugin: false }
      : { text: extracting, plugin: true };
  }

  if (reported !== null && reported.name === started) {
    const text = pluginText(row.display, reported);

    if (text !== null) {
      return { text, plugin: true };
    }
  }

  return {
    text: `Running ${row.display}\u2026 ${at + 1} of ${sensors.length}`,
    plugin: true,
  };
}

function pluginText(display: string, reported: PluginProgress): string | null {
  const counted = reported.progress;

  return counted === undefined
    ? null
    : `${display}: ${counted.done} of ${counted.total} ${counted.unit}`;
}

function capitalised(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function showTarget(progress: RunProgress): ShowTarget | null {
  const module = progress.describe?.firstFailure ?? null;

  if (module !== null) {
    return {
      kind: "module",
      id: module.item,
      reason: module.reason,
    };
  }

  const sensor = failures(progress.sense?.entries ?? [])[0];

  if (sensor !== undefined) {
    return {
      kind: "sensor",
      name: sensor.name,
      reason: sensor.reason ?? "failed",
    };
  }

  return null;
}
