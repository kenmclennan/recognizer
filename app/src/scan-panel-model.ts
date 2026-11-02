import {
  type Config,
  type Overlay,
  parseConfig,
  registeredSensors,
  validateOverlay,
} from "recognizer";
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
  measure: boolean;
  overlays: string[] | null;
  sensors: boolean;
  ticked: string[] | null;
  once: string[];
};

export type ScanPlan = {
  describe: boolean;
  measure: string[];
  sense: string[];
};

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
  overlays: { name: string; text: string }[];
  measureRun: RunState;
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

export type ReportRow = {
  name: string;
  chip: string;
  commit: string;
  stale: boolean;
};

export type MeasureRow = {
  name: string;
  ticked: boolean;
  subline: string;
  chip: string;
  tone: ChipTone;
  reason: string | null;
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
  measure: {
    ticked: boolean;
    tickable: boolean;
    rows: MeasureRow[];
  };
  sensors: {
    ticked: boolean;
    tickable: boolean;
    rows: SensorRow[];
    reports: ReportRow[];
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

export type RegisteredOverlay = {
  name: string;
  command: string;
  runsTests: boolean;
};

export function registeredOverlays(config: string | null): RegisteredOverlay[] {
  const overlays = readConfig(config)?.overlays ?? {};

  return Object.entries(overlays).map(([name, registration]) => ({
    name,
    command: registration.command[0] ?? "",
    runsTests: registration.runs_tests === true,
  }));
}

export function registeredOverlayNames(config: string | null): string[] {
  return registeredOverlays(config).map(({ name }) => name);
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
  overlays: string[] = [],
  testing: string[] = [],
): { plan: ScanPlan; dropped: string[] } {
  const wanted = ticks.ticked ?? registered;
  const sense = wanted.filter((name) => registered.includes(name));
  const dropped = wanted.filter((name) => !registered.includes(name));
  const wantedOverlays = ticks.overlays ?? overlays;
  const measure = [
    ...wantedOverlays.filter(
      (name) => overlays.includes(name) && !testing.includes(name),
    ),
    ...testing.filter(
      (name) => overlays.includes(name) && ticks.once.includes(name),
    ),
  ];

  return {
    plan: {
      describe: ticks.describe && describerRegistered,
      measure: ticks.measure ? measure : [],
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

  if (plan.measure.length > 0) {
    flags.push("--measure", plan.measure.join(","));
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

  if (plan.measure.length > 0) {
    parts.push(
      plan.measure.length === 1
        ? "1 measurer"
        : `${plan.measure.length} measurers`,
    );
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

function overlayFile(
  files: PanelInput["overlays"],
  name: string,
): Overlay | null {
  const text = files.find((file) => file.name === name)?.text;

  if (text === undefined) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as Overlay;

    return validateOverlay(parsed, {
      commit: parsed.commit,
      modified: parsed.modified,
      metrics: parsed.metrics,
    });
  } catch {
    return null;
  }
}

function sameCommit(a: string, b: string): boolean {
  return a !== "" && b !== "" && (a.startsWith(b) || b.startsWith(a));
}

function measureRow(overlay: RegisteredOverlay, input: PanelInput): MeasureRow {
  const { name } = overlay;
  const run = input.measureRun;
  const base = {
    name,
    ticked: overlay.runsTests
      ? input.ticks.once.includes(name)
      : input.ticks.overlays === null || input.ticks.overlays.includes(name),
    subline: overlay.runsTests
      ? `${overlay.command} · runs the tests · ticked for one Scan only`
      : overlay.command,
  };
  const held = run.failures[name];

  if (run.running.includes(name)) {
    return { ...base, chip: "running", tone: "amber", reason: null };
  }

  if (held !== undefined) {
    return { ...base, chip: "failed", tone: "red", reason: held };
  }

  const file = overlayFile(input.overlays, name);

  if (file === null) {
    return { ...base, chip: "not run", tone: "muted", reason: null };
  }

  const scanCommit = input.scan?.origin.commit ?? null;

  if (scanCommit === null || !sameCommit(file.commit, scanCommit)) {
    return { ...base, chip: "stale", tone: "amber", reason: null };
  }

  if (file.modified) {
    return { ...base, chip: "modified tree", tone: "amber", reason: null };
  }

  const at = run.ranAt[name];

  return {
    ...base,
    chip: at === undefined ? "ran" : `ran ${ageText(at, input.now)}`,
    tone: "ok",
    reason: null,
  };
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
  const overlays = registeredOverlays(input.config);
  const { plan } = phasesFor(
    input.ticks,
    names,
    describer !== null,
    overlays.map(({ name }) => name),
    overlays.filter(({ runsTests }) => runsTests).map(({ name }) => name),
  );
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
    measure: {
      ticked: input.ticks.measure && overlays.length > 0,
      tickable: overlays.length > 0,
      rows: overlays.map((one) => measureRow(one, input)),
    },
    sensors: {
      ticked: input.ticks.sensors && names.length > 0,
      tickable: names.length > 0,
      rows,
      reports: reportRows(input.sensors, input.now),
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
      Object.keys(input.run.failures).length > 0 ||
      Object.keys(input.measureRun.failures).length > 0,
  };
}
