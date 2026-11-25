import { roundedTime } from "./estimate-text";
import type { RunProgress } from "./scan-progress";

export const FINDING_STAGE = "Finding the languages in this repository";

export const READ_STAGE = "Finishing the scan";

export const MIN_RATE_SECONDS = 5;

export type OpenBar =
  | { kind: "indeterminate" }
  | { kind: "determinate"; fraction: number };

export type OpenRowState = "waiting" | "running" | "done" | "failed";

export type OpenRow = {
  key: string;
  name: string;
  state: OpenRowState;
  text: string;
  logLink: boolean;
};

export type OpenProgress = {
  kind: "progress";
  title: string;
  stage: string;
  bar: OpenBar;
  counts: string;
  timeLeft: string | null;
  rows: OpenRow[];
  elapsed: string;
};

export type OpenStopped = {
  kind: "stopped";
  title: string;
  message: string;
  again: string;
};

export type OpenModel = OpenProgress | OpenStopped;

export type OpenInput = {
  folder: string;
  progress: RunProgress;
  startedAt: number;
  now: number;
  stopped: boolean;
};

export const STOPPED_MODEL: OpenStopped = {
  kind: "stopped",
  title: "Scan stopped",
  message: "Nothing is shown until a scan of this repository completes",
  again: "Scan again",
};

function capitalised(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function grouped(value: number): string {
  return value.toLocaleString("en-GB");
}

export function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));

  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

type Counted = { done: number; total: number };

function countedOf(progress: RunProgress, language: string): Counted | null {
  const reported = progress.sensorProgress;

  if (
    reported !== null &&
    reported.phase === "extract" &&
    reported.name === language &&
    reported.progress !== undefined
  ) {
    return {
      done: reported.progress.done,
      total: reported.progress.total,
    };
  }

  const total = progress.timing.extractTotals[language];

  return total === undefined ? null : { done: 0, total };
}

function rowOf(
  progress: RunProgress,
  language: string,
  running: string | null,
): OpenRow {
  const { timing } = progress;
  const entry = progress.extractEntries.find((one) => one.name === language);
  const name = capitalised(language);
  const base = { key: language, name, logLink: false };

  if (entry?.outcome === "failed") {
    return {
      ...base,
      state: "failed",
      text: "failed",
      logLink: progress.log !== null,
    };
  }

  if (entry?.outcome === "ok") {
    const total = timing.extractTotals[language];
    const began = timing.extractAt[language];
    const ended = timing.extractDoneAt[language];
    const files = total === undefined ? null : `${grouped(total)} files`;
    const seconds =
      began === undefined || ended === undefined
        ? null
        : `${Math.max(0, Math.round((ended - began) / 1000))}s`;

    return {
      ...base,
      state: "done",
      text: [files, seconds].filter((part) => part !== null).join(" · "),
    };
  }

  if (language === running) {
    const counted = countedOf(progress, language);

    return {
      ...base,
      state: "running",
      text:
        counted === null
          ? ""
          : `${grouped(counted.done)} / ${grouped(counted.total)}`,
    };
  }

  return { ...base, state: "waiting", text: "waiting" };
}

function runningOf(progress: RunProgress, languages: string[]): string | null {
  return (
    languages.find(
      (language) =>
        language in progress.timing.extractAt &&
        !progress.extractEntries.some((entry) => entry.name === language),
    ) ?? null
  );
}

export function barOf(counted: Counted | null): OpenBar {
  if (counted === null) {
    return { kind: "indeterminate" };
  }

  if (counted.total === 0) {
    return { kind: "determinate", fraction: 1 };
  }

  return {
    kind: "determinate",
    fraction: Math.min(1, Math.max(0, counted.done / counted.total)),
  };
}

export function timeLeftOf(
  counted: Counted | null,
  ranMs: number,
): string | null {
  if (
    counted === null ||
    counted.done <= 0 ||
    ranMs < MIN_RATE_SECONDS * 1000
  ) {
    return null;
  }

  const perMs = counted.done / ranMs;
  const leftMs = Math.max(0, counted.total - counted.done) / perMs;

  return `${roundedTime(leftMs)} left`;
}

export function openProgressModel(input: OpenInput): OpenModel {
  if (input.stopped) {
    return STOPPED_MODEL;
  }

  const { progress, now } = input;
  const languages = progress.languages ?? [];
  const running = runningOf(progress, languages);
  const counted = running === null ? null : countedOf(progress, running);
  const began =
    running === null ? undefined : progress.timing.extractAt[running];
  const read =
    languages.length > 0 &&
    languages.every((language) =>
      progress.extractEntries.some((entry) => entry.name === language),
    );

  return {
    kind: "progress",
    title: `Scanning ${input.folder}`,
    stage:
      running !== null
        ? `Reading ${capitalised(running)} files`
        : read
          ? READ_STAGE
          : FINDING_STAGE,
    bar: read ? { kind: "determinate", fraction: 1 } : barOf(counted),
    counts:
      counted === null
        ? ""
        : `${grouped(counted.done)} of ${grouped(counted.total)} files`,
    timeLeft:
      began === undefined
        ? null
        : timeLeftOf(counted, Math.max(0, now - began)),
    rows: languages.map((language) => rowOf(progress, language, running)),
    elapsed: elapsedText(now - input.startedAt),
  };
}
