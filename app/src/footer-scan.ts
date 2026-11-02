import type { ScanFooter } from "./scan-progress";

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
  progress: ScanFooter | null;
  canShow: boolean;
  log: string | null;
};

export type ScanLine = {
  kind: "up-to-date" | "files" | "moved" | "scanning" | "result";
  text: string;
  tone: "muted" | "amber";
  files: FileChange[];
  rescan: "none" | "enabled" | "disabled";
  stop: boolean;
  show: boolean;
  openLog: boolean;
};

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
  const idle = { stop: false, show: false, openLog: false };
  const { progress } = state;

  if (progress?.running) {
    return {
      kind: "scanning",
      text: progress.text,
      tone: "muted",
      files: [],
      rescan: "disabled",
      stop: true,
      show: false,
      openLog: false,
    };
  }

  const { moved, files } = state.changes;

  if (progress !== null && moved === null && files.length === 0) {
    const failed = progress.failed > 0;

    return {
      kind: "result",
      text: progress.text,
      tone: progress.tone,
      files: [],
      rescan: "enabled",
      stop: false,
      show: failed && state.canShow,
      openLog: failed && state.log !== null,
    };
  }

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
      ...idle,
    };
  }

  if (files.length > 0) {
    return {
      kind: "files",
      text: `${plural(files.length, "file")} changed since`,
      tone: "amber",
      files,
      rescan: "enabled",
      ...idle,
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
    ...idle,
  };
}
