import type { SensorStatus } from "./sensor-run";

export type FileChange = {
  path: string;
  kind: "modified" | "added" | "deleted";
};

export type Changes = {
  files: FileChange[];
  moved: { branch: string | null; commit: string } | null;
};

export type ScanOrigin = { branch: string | null; commit: string | null };

export type ScanState = {
  origin: ScanOrigin;
  scannedAt: number;
  changes: Changes;
  rescanning: boolean;
  sensors: SensorStatus[];
};

export type ScanLine = {
  kind: "up-to-date" | "files" | "moved" | "rescanning";
  text: string;
  tone: "muted" | "amber";
  files: FileChange[];
  rescan: "none" | "enabled" | "disabled";
  sensors: SensorsLine | null;
};

export type SensorsLine = {
  text: string;
  tone: "muted" | "amber";
  title: string;
};

export function sensorsLine(sensors: SensorStatus[]): SensorsLine | null {
  if (sensors.length === 0) {
    return null;
  }

  const parts = sensors.map(({ name, status }) => `${name} ${status}`);
  const reasons = sensors
    .filter(({ reason }) => reason !== undefined)
    .map(({ name, reason }) => `${name}: ${reason}`);

  return {
    text: `Sensors: ${parts.join(", ")}`,
    tone: sensors.some(({ status }) => status === "failed") ? "amber" : "muted",
    title: reasons.join("\n"),
  };
}

export const NO_CHANGES: Changes = { files: [], moved: null };

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function ageText(scannedAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - scannedAt) / 60000);

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${plural(minutes, "minute")} ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${plural(hours, "hour")} ago`;
  }

  return `${plural(Math.floor(hours / 24), "day")} ago`;
}

export function scanLine(state: ScanState, now: number): ScanLine {
  return {
    ...scanLineWithoutSensors(state, now),
    sensors: sensorsLine(state.sensors),
  };
}

type ScanLineBase = Omit<ScanLine, "sensors">;

function scanLineWithoutSensors(state: ScanState, now: number): ScanLineBase {
  if (state.rescanning) {
    return {
      kind: "rescanning",
      text: "Rescanning...",
      tone: "muted",
      files: [],
      rescan: "disabled",
    };
  }

  const { moved, files } = state.changes;

  if (moved !== null) {
    return {
      kind: "moved",
      text:
        moved.branch === null
          ? `Now at ${moved.commit}`
          : `Now on ${moved.branch} at ${moved.commit}`,
      tone: "amber",
      files: [],
      rescan: "enabled",
    };
  }

  if (files.length > 0) {
    return {
      kind: "files",
      text: `${plural(files.length, "file")} changed since`,
      tone: "amber",
      files,
      rescan: "enabled",
    };
  }

  const head =
    state.origin.commit === null
      ? "Scanned"
      : `Scanned at ${state.origin.commit},`;

  return {
    kind: "up-to-date",
    text: `${head} ${ageText(state.scannedAt, now)}`,
    tone: "muted",
    files: [],
    rescan: "none",
  };
}
