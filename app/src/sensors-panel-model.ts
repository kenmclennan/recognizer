import { parseConfig, registeredSensors } from "recognizer";
import { ageText, type ScanState } from "./footer-scan";
import type { SensorStatus } from "./sensor-run";

export type RunState = {
  running: string[];
  failures: Record<string, string>;
  ranAt: Record<string, number>;
};

export const NO_RUN: RunState = { running: [], failures: {}, ranAt: {} };

export type PanelInput = {
  scan: ScanState | null;
  scanFiles: string[];
  config: string | null;
  sensors: SensorStatus[];
  ticked: string[];
  run: RunState;
  now: number;
};

export type ScanSummary = {
  commit: string | null;
  ageText: string;
  languages: string[];
};

export type ChipTone = "ok" | "amber" | "red" | "muted";

export type SensorRow = {
  name: string;
  kind: "structure" | "registered";
  tickable: boolean;
  ticked: boolean;
  chip: string;
  tone: ChipTone;
  reason: string | null;
};

export type PanelModel = {
  scan: ScanSummary | null;
  rows: SensorRow[];
  buttons: { runSelected: boolean; runAll: boolean };
  mark: boolean;
};

const SCAN_FILE = /^scan\.(.+)\.json$/;

export function scanLanguages(files: string[]): string[] {
  return files
    .map((file) => SCAN_FILE.exec(file)?.[1])
    .filter((language): language is string => language !== undefined)
    .sort();
}

function registeredNames(config: string | null): string[] {
  if (config === null) {
    return [];
  }

  try {
    return registeredSensors(parseConfig(config)).map(({ name }) => name);
  } catch {
    return [];
  }
}

function structureRow(status: SensorStatus | undefined): SensorRow {
  const off = status?.status === "off";

  return {
    name: "structure",
    kind: "structure",
    tickable: false,
    ticked: false,
    chip: off ? "off" : "runs with every scan",
    tone: "muted",
    reason: null,
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
    ticked: input.ticked.includes(name),
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

export function sensorsPanel(input: PanelInput): PanelModel {
  const names = registeredNames(input.config);
  const statusOf = (name: string) =>
    input.sensors.find((status) => status.name === name);
  const rows = [
    structureRow(statusOf("structure")),
    ...names.map((name) => registeredRow(name, statusOf(name), input)),
  ];
  const idle = input.run.running.length === 0;
  const anyTicked = rows.some((row) => row.ticked);

  return {
    scan:
      input.scan === null
        ? null
        : {
            commit: input.scan.origin.commit,
            ageText: ageText(input.scan.scannedAt, input.now),
            languages: scanLanguages(input.scanFiles),
          },
    rows,
    buttons: {
      runSelected: idle && anyTicked,
      runAll: idle && names.length > 0,
    },
    mark:
      input.sensors.some(({ status }) => status === "failed") ||
      Object.keys(input.run.failures).length > 0,
  };
}
