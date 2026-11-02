import { type Config, parseConfig, registeredSensors } from "recognizer";
import { ageText, type ScanState } from "./footer-scan";
import type { ResponsibilityState } from "./responsibility-model";
import type { SensorStatus, ShippedSensors } from "./sensor-run";

export type RunState = {
  running: string[];
  failures: Record<string, string>;
  ranAt: Record<string, number>;
};

export const NO_RUN: RunState = { running: [], failures: {}, ranAt: {} };

export function sessionStatuses(
  sensors: SensorStatus[],
  run: RunState,
): SensorStatus[] {
  const held = Object.entries(run.failures);

  if (held.length === 0) {
    return sensors;
  }

  const known = new Set(sensors.map(({ name }) => name));
  const overlaid = sensors.map((one) => {
    const reason = run.failures[one.name];

    return reason === undefined
      ? one
      : { name: one.name, status: "failed" as const, reason };
  });
  const added = held
    .filter(([name]) => !known.has(name))
    .map(([name, reason]) => ({ name, status: "failed" as const, reason }));

  return [...overlaid, ...added];
}

export type ScanTicks = {
  describe: boolean;
  sensors: boolean;
  ticked: string[] | null;
};

export type ScanPlan = { describe: boolean; sense: string[] };

export type PanelInput = {
  scan: ScanState | null;
  scanFiles: string[];
  counts: { modules: number; edges: number };
  config: string | null;
  sensors: SensorStatus[];
  structure: { violations: number; warnings: number } | null;
  lines: { modules: string[]; of: (id: string) => ResponsibilityState };
  ticks: ScanTicks;
  run: RunState;
  scanning: boolean;
  now: number;
  shipped: ShippedSensors | null;
  editMessage: string | null;
};

export type ChipTone = "ok" | "amber" | "red" | "muted";

export type SensorRow = {
  name: string;
  kind: "structure" | "registered";
  tickable: boolean;
  ticked: boolean;
  chip: string;
  tone: ChipTone;
  extra: { text: string; tone: ChipTone } | null;
  reason: string | null;
  removable: boolean;
};

export type AddSensors =
  | { status: "hidden" }
  | { status: "unavailable"; reason: string }
  | { status: "list"; items: { name: string; line: string }[] };

export type ScanPanelModel = {
  head: { commit: string | null; ageText: string } | null;
  extract: {
    languages: string[];
    modules: number;
    edges: number;
    status: string;
    tone: ChipTone;
  };
  describe: {
    ticked: boolean;
    tickable: boolean;
    counts: { current: number; outOfDate: number; missing: number };
    describer: string | null;
  };
  sensors: {
    ticked: boolean;
    tickable: boolean;
    rows: SensorRow[];
    add: AddSensors;
    editable: boolean;
    message: string | null;
  };
  button: {
    mode: "scan" | "stop";
    label: string;
    summary: string;
    flags: string;
  };
  mark: boolean;
};

const SCAN_FILE = /^scan\.(.+)\.json$/;

export function scanLanguages(files: string[]): string[] {
  return files
    .map((file) => SCAN_FILE.exec(file)?.[1])
    .filter((language): language is string => language !== undefined)
    .sort();
}

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

export function registeredNames(config: string | null): string[] {
  const parsed = readConfig(config);

  return parsed === null
    ? []
    : registeredSensors(parsed).map(({ name }) => name);
}

export function describerOf(config: string | null): string | null {
  const describer = readConfig(config)?.describer;

  return describer === undefined
    ? null
    : `${describer.command.join(" ")} ${describer.version}`;
}

export function phasesFor(
  ticks: ScanTicks,
  registered: string[],
  describerRegistered: boolean,
): { plan: ScanPlan; dropped: string[] } {
  const wanted = ticks.ticked ?? registered;
  const sense = wanted.filter((name) => registered.includes(name));
  const dropped = wanted.filter((name) => !registered.includes(name));

  return {
    plan: {
      describe: ticks.describe && describerRegistered,
      sense: ticks.sensors ? sense : [],
    },
    dropped,
  };
}

export function scanFlags(plan: ScanPlan): string[] {
  const flags: string[] = [];

  if (plan.describe) {
    flags.push("--describe");
  }

  if (plan.sense.length > 0) {
    flags.push("--sense", plan.sense.join(","));
  }

  return flags;
}

export function scanCaption(
  plan: ScanPlan,
  extractionExpected: boolean,
): string {
  const parts = [extractionExpected ? "extract" : "scans current"];

  if (plan.describe) {
    parts.push("describe");
  }

  if (plan.sense.length > 0) {
    parts.push(
      plan.sense.length === 1 ? "1 sensor" : `${plan.sense.length} sensors`,
    );
  }

  return parts.join(", ");
}

function structureRow(
  status: SensorStatus | undefined,
  counts: PanelInput["structure"],
): SensorRow {
  const off = status?.status === "off";
  const extra =
    off || counts === null
      ? null
      : {
          text: `${counts.violations} ${counts.violations === 1 ? "violation" : "violations"}, ${counts.warnings} ${counts.warnings === 1 ? "warning" : "warnings"}`,
          tone: (counts.violations > 0
            ? "red"
            : counts.warnings > 0
              ? "amber"
              : "ok") as ChipTone,
        };

  return {
    name: "structure",
    kind: "structure",
    tickable: false,
    ticked: false,
    chip: off ? "off" : "every scan",
    tone: "muted",
    extra,
    reason: null,
    removable: false,
  };
}

function registeredRow(
  name: string,
  status: SensorStatus | undefined,
  input: PanelInput,
): SensorRow {
  const base = {
    name,
    kind: "registered" as const,
    tickable: true,
    ticked: input.ticks.ticked === null || input.ticks.ticked.includes(name),
    extra: null,
    removable:
      input.shipped?.status === "ok" &&
      input.shipped.sensors.some((one) => one.name === name),
  };
  const held = input.run.failures[name];

  if (input.run.running.includes(name)) {
    return { ...base, chip: "running", tone: "amber", reason: null };
  }

  if (held !== undefined) {
    return { ...base, chip: "failed", tone: "red", reason: held };
  }

  switch (status?.status) {
    case "ran": {
      const at = input.run.ranAt[name];

      return {
        ...base,
        chip: at === undefined ? "ran" : `ran ${ageText(at, input.now)}`,
        tone: "ok",
        reason: null,
      };
    }
    case "stale":
      return { ...base, chip: "stale", tone: "amber", reason: null };
    case "failed":
      return {
        ...base,
        chip: "failed",
        tone: "red",
        reason: status.reason ?? null,
      };
    default:
      return { ...base, chip: "not run", tone: "muted", reason: null };
  }
}

function addBlock(shipped: ShippedSensors | null, names: string[]): AddSensors {
  if (shipped === null) {
    return { status: "hidden" };
  }

  if (shipped.status === "unavailable") {
    return { status: "unavailable", reason: shipped.reason };
  }

  const items = shipped.sensors
    .filter(({ name }) => !names.includes(name))
    .map(({ name, line }) => ({ name, line }));

  return items.length === 0 ? { status: "hidden" } : { status: "list", items };
}

function lineCounts(lines: PanelInput["lines"]) {
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

function extractBlock(input: PanelInput): ScanPanelModel["extract"] {
  const base = {
    languages: scanLanguages(input.scanFiles),
    modules: input.counts.modules,
    edges: input.counts.edges,
  };

  if (input.scan === null) {
    return { ...base, status: "no scan yet", tone: "muted" };
  }

  const { files, moved } = input.scan.changes;

  if (files.length === 0 && moved === null) {
    return { ...base, status: "current", tone: "ok" };
  }

  return {
    ...base,
    status: `files changed since ${input.scan.origin.commit ?? "the scan"}`,
    tone: "amber",
  };
}

export function scanPanel(input: PanelInput): ScanPanelModel {
  const names = registeredNames(input.config);
  const describer = describerOf(input.config);
  const statusOf = (name: string) =>
    input.sensors.find((status) => status.name === name);
  const rows = [
    structureRow(statusOf("structure"), input.structure),
    ...names.map((name) => registeredRow(name, statusOf(name), input)),
  ];
  const extract = extractBlock(input);
  const { plan } = phasesFor(input.ticks, names, describer !== null);
  const expected = input.scan === null || extract.tone === "amber";

  return {
    head:
      input.scan === null
        ? null
        : {
            commit: input.scan.origin.commit,
            ageText: ageText(input.scan.scannedAt, input.now),
          },
    extract,
    describe: {
      ticked: input.ticks.describe && describer !== null,
      tickable: describer !== null,
      counts: lineCounts(input.lines),
      describer,
    },
    sensors: {
      ticked: input.ticks.sensors && names.length > 0,
      tickable: names.length > 0,
      rows,
      add: addBlock(input.shipped, names),
      editable: !input.scanning,
      message: input.editMessage,
    },
    button: {
      mode: input.scanning ? "stop" : "scan",
      label: input.scanning ? "Stop" : "Scan",
      summary: scanCaption(plan, expected),
      flags: ["recognizer", "scan", ...scanFlags(plan)].join(" "),
    },
    mark:
      input.sensors.some(({ status }) => status === "failed") ||
      Object.keys(input.run.failures).length > 0,
  };
}
