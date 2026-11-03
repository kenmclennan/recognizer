import {
  type Config,
  parseConfig,
  registeredSensors,
  shippedSensorNames,
} from "recognizer";
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
};

export type ScanPlan = {
  describe: boolean;
  sense: string[];
};

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
  run: RunState;
  scanning: boolean;
  now: number;
  shipped: ShippedSensors | null;
};

export type StateTone = "muted" | "ok" | "warn" | "run";

export type ScanRow = {
  key: string;
  name: string;
  tickable: true;
  ticked: boolean;
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
        title: one.line,
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
    plan: { describe: ticks.describe, sense },
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

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function withAge(text: string, at: number | null | undefined, now: number) {
  return at === null || at === undefined
    ? text
    : `${text}, ${ageText(at, now)}`;
}

function liveState(
  key: string,
  input: PanelInput,
): { text: string; tone: StateTone } | null {
  if (!input.scanning || !input.run.running.includes(key)) {
    return null;
  }

  return input.run.started === key
    ? { text: "running", tone: "run" }
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

  const counts = lineCounts(input.lines);

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

function sensorState(name: string, input: PanelInput): ScanRow["state"] {
  const live = liveState(name, input);

  if (live !== null) {
    return live;
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
    return { text: "Scanning…", changed: null };
  }

  if (input.scan === null) {
    return { text: "Not scanned yet", changed: null };
  }

  const { files, moved } = input.scan.changes;
  const changed = files.length > 0 || moved !== null;

  return {
    text: `Scanned ${ageText(input.scan.scannedAt, input.now)}`,
    changed: changed ? "files changed since" : null,
  };
}

export function scanPanel(input: PanelInput): ScanPanelModel {
  if (input.shipped === null) {
    return {
      header: header(input),
      rows: [],
      reports: [],
      button: {
        scanning: input.scanning,
        label: input.scanning ? "Scanning" : "Scan",
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
      state: describeState(input),
      title: DESCRIBE_TITLE,
    },
    ...sensors.map((one) => ({
      key: one.name,
      name: one.display,
      tickable: true as const,
      ticked: one.runsTests
        ? input.ticks.once.includes(one.name)
        : (input.ticks.ticked ?? plain).includes(one.name),
      state: sensorState(one.name, input),
      title: one.title,
    })),
  ];

  return {
    header: header(input),
    rows,
    reports: reportRows(input.sensors, input.now),
    button: {
      scanning: input.scanning,
      label: input.scanning ? "Scanning" : "Scan",
    },
    pending: false,
    mark: panelMark(input),
  };
}

function panelMark(input: PanelInput): boolean {
  return (
    input.sensors.some(({ status }) => status === "failed") ||
    Object.keys(input.run.failures).length > 0
  );
}
