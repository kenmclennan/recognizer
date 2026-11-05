import {
  type Config,
  parseConfig,
  registeredSensors,
  type Scan,
  shippedSensorNames,
} from "recognizer";
import { scopeCaption } from "./findings-scope";
import { ageText, type ScanState } from "./footer-scan";
import type { ResponsibilityState } from "./responsibility-model";
import type { SensorStatus, ShippedSensors } from "./sensor-run";

export type RunState = {
  running: string[];
  started: string | null;
  failures: Record<string, string>;
  ranAt: Record<string, number>;
};

export const NO_RUN: RunState = {
  running: [],
  started: null,
  failures: {},
  ranAt: {},
};

export const DESCRIBE_KEY = "describe";

export type ScanTicks = {
  describe: boolean;
  ticked: string[] | null;
  once: string[];
  onlyView: boolean;
};

export type ScanPlan = {
  describe: boolean;
  sense: string[];
  modules: string[] | null;
};

export const MUTATION_KEY = "mutation";

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
  scans?: Scan[];
  run: RunState;
  scanning: boolean;
  progressText?: string | null;
  describeProgress?: { entries: number; total: number } | null;
  now: number;
  shipped: ShippedSensors | null;
};

export type StateTone = "muted" | "ok" | "warn" | "run" | "size";

export type ScanRow = {
  key: string;
  name: string;
  tickable: true;
  ticked: boolean;
  disabled: boolean;
  state: { text: string; tone: StateTone };
  title: string;
};

export type ReportRow = {
  name: string;
  chip: string;
  commit: string;
  stale: boolean;
};

export type ScanPanelModel = {
  header: { text: string; changed: string | null };
  scope: { caption: string; on: boolean; disabled: boolean } | null;
  rows: ScanRow[];
  reports: ReportRow[];
  button: { scanning: boolean; label: string };
  pending: boolean;
  mark: boolean;
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
    plan: { describe: ticks.describe, sense, modules: null },
    dropped: wanted.filter((name) => !known.includes(name)),
  };
}

export function lineCounts(lines: PanelInput["lines"]) {
  const counts = { current: 0, outOfDate: 0, missing: 0 };

  for (const id of lines.modules) {
    const kind = lines.of(id).kind;

    if (kind === "current") {
      counts.current += 1;
    } else if (kind === "out-of-date") {
      counts.outOfDate += 1;
    } else if (kind === "missing") {
      counts.missing += 1;
    }
  }

  return counts;
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

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function withAge(text: string, at: number | null | undefined, now: number) {
  return at === null || at === undefined
    ? text
    : `${text}, ${ageText(at, now)}`;
}

function runningText(key: string, input: PanelInput): string {
  const describe = input.describeProgress ?? null;

  return key === DESCRIBE_KEY && describe !== null
    ? `${describe.entries} of ${describe.total}`
    : "running";
}

function liveState(
  key: string,
  input: PanelInput,
): { text: string; tone: StateTone } | null {
  if (!input.scanning || !input.run.running.includes(key)) {
    return null;
  }

  return input.run.started === key
    ? { text: runningText(key, input), tone: "run" }
    : { text: "waiting", tone: "muted" };
}

function describeState(input: PanelInput): ScanRow["state"] {
  const live = liveState(DESCRIBE_KEY, input);

  if (live !== null) {
    return live;
  }

  const at = input.run.ranAt[DESCRIBE_KEY] ?? input.describedAt;

  if (input.run.failures[DESCRIBE_KEY] !== undefined) {
    return {
      text: withAge("failed", input.run.ranAt[DESCRIBE_KEY], input.now),
      tone: "warn",
    };
  }

  const counts = lineCounts({
    modules: scopedIds(input) ?? input.lines.modules,
    of: input.lines.of,
  });
  const stale = counts.outOfDate + counts.missing;

  if (stale > 0) {
    return { text: `${stale} to describe`, tone: "muted" };
  }

  if (counts.current + counts.outOfDate > 0) {
    return {
      text: withAge(
        `${counts.current} ${counts.current === 1 ? "module" : "modules"} described`,
        at,
        input.now,
      ),
      tone: "ok",
    };
  }

  return { text: "not yet run", tone: "muted" };
}

function mutationSize(input: PanelInput): ScanRow["state"] | null {
  if (input.scanning || !input.ticks.once.includes(MUTATION_KEY)) {
    return null;
  }

  const count = functionCount(input.scans ?? [], scopedIds(input));

  return count > 0 ? { text: plural(count, "function"), tone: "size" } : null;
}

function sensorState(name: string, input: PanelInput): ScanRow["state"] {
  const live = liveState(name, input);

  if (live !== null) {
    return live;
  }

  if (name === MUTATION_KEY) {
    const size = mutationSize(input);

    if (size !== null) {
      return size;
    }
  }

  const status = input.sensors.find((one) => one.name === name);

  if (input.run.failures[name] !== undefined) {
    return {
      text: withAge("failed", input.run.ranAt[name], input.now),
      tone: "warn",
    };
  }

  if (status?.status === "failed") {
    return { text: "failed", tone: "warn" };
  }

  if (
    (status?.status === "ran" || status?.status === "stale") &&
    status.stopped !== undefined
  ) {
    const at = input.run.ranAt[name] ?? status.modifiedMs;
    const { measured, total } = status.stopped;

    return measured > 0
      ? {
          text: withAge(
            `stopped, ${measured} of ${total} functions measured`,
            at,
            input.now,
          ),
          tone: "ok",
        }
      : {
          text: withAge("stopped, nothing measured", at, input.now),
          tone: "muted",
        };
  }

  if (
    (status?.status === "ran" || status?.status === "stale") &&
    status.findings !== undefined
  ) {
    return {
      text: withAge(
        plural(status.findings, "finding"),
        input.run.ranAt[name] ?? status.modifiedMs,
        input.now,
      ),
      tone: "ok",
    };
  }

  return { text: "not yet run", tone: "muted" };
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

function header(input: PanelInput): ScanPanelModel["header"] {
  if (input.scanning) {
    return { text: input.progressText ?? "Scanning…", changed: null };
  }

  if (input.scan === null) {
    return { text: "Not scanned yet", changed: null };
  }

  const { files, moved } = input.scan.changes;
  const changed = files.length > 0 || moved !== null;

  return {
    text: `Ran ${ageText(input.scan.scannedAt, input.now)}`,
    changed: changed ? "files changed since" : null,
  };
}

export function scanPanel(input: PanelInput): ScanPanelModel {
  if (input.shipped === null) {
    return {
      header: header(input),
      scope: null,
      rows: [],
      reports: [],
      button: {
        scanning: input.scanning,
        label: input.scanning ? "Running" : "Run",
      },
      pending: true,
      mark: panelMark(input),
    };
  }

  const sensors = rowSensors(input.config, input.shipped);
  const plain = sensors
    .filter(({ runsTests }) => !runsTests)
    .map(({ name }) => name);
  const rows: ScanRow[] = [
    {
      key: DESCRIBE_KEY,
      name: "Descriptions",
      tickable: true,
      ticked: input.ticks.describe,
      disabled: input.scanning,
      state: describeState(input),
      title: DESCRIBE_TITLE,
    },
    ...sensors.map((one) => ({
      key: one.name,
      name: one.display,
      tickable: true as const,
      disabled: input.scanning,
      ticked: one.runsTests
        ? input.ticks.once.includes(one.name)
        : (input.ticks.ticked ?? plain).includes(one.name),
      state: sensorState(one.name, input),
      title: one.title,
    })),
  ];

  return {
    header: header(input),
    scope: scopeOf(input),
    rows,
    reports: reportRows(input.sensors, input.now),
    button: {
      scanning: input.scanning,
      label: input.scanning ? "Running" : "Run",
    },
    pending: false,
    mark: panelMark(input),
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
  };
}

function panelMark(input: PanelInput): boolean {
  return (
    input.sensors.some(({ status }) => status === "failed") ||
    Object.keys(input.run.failures).length > 0
  );
}
