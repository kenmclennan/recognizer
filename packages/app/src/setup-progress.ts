import { parseScanLine } from "./scan-progress";

export type Progress = "waiting" | "running" | "done";

export type Timed = {
  state: Progress;
  startedAt: number | null;
  endedAt: number | null;
};

export type LanguageProgress = {
  name: string;
  state: "waiting" | "reading" | "done";
  files: number | null;
};

export type DuplicationProgress = {
  state: "comparing" | "done" | "failed";
  files: number | null;
};

export type LoadingState = {
  startedAt: number;
  survey: Timed;
  scan: Timed | null;
  reading: Timed;
  held: Array<"run" | "done">;
  languages: LanguageProgress[];
  languagesKnown: boolean;
  duplication: DuplicationProgress | null;
  fill: number;
};

const WAITING: Timed = { state: "waiting", startedAt: null, endedAt: null };

export function startLoading(now: number): LoadingState {
  return {
    startedAt: now,
    survey: { ...WAITING },
    scan: null,
    reading: { ...WAITING },
    held: [],
    languages: [],
    languagesKnown: false,
    duplication: null,
    fill: 0,
  };
}

function began(row: Timed, now: number): Timed {
  return row.state === "waiting"
    ? { state: "running", startedAt: now, endedAt: null }
    : row;
}

function finished(row: Timed, now: number): Timed {
  return row.state === "done"
    ? row
    : { state: "done", startedAt: row.startedAt ?? now, endedAt: now };
}

function readingStep(
  state: LoadingState,
  phase: "run" | "done",
  now: number,
): LoadingState {
  return {
    ...state,
    reading:
      phase === "run"
        ? began(state.reading, now)
        : finished(state.reading, now),
  };
}

function scanEnded(state: LoadingState, now: number): LoadingState {
  const ended: LoadingState = {
    ...state,
    scan: finished(state.scan ?? { ...WAITING }, now),
    held: [],
  };

  return state.held.reduce(
    (current, phase) => readingStep(current, phase, now),
    ended,
  );
}

function stepOf(
  state: LoadingState,
  step: string,
  phase: string,
  now: number,
): LoadingState {
  const running = phase === "run";

  if (step === "survey") {
    return {
      ...state,
      survey: running ? began(state.survey, now) : finished(state.survey, now),
    };
  }

  if (step === "reading") {
    const at = running ? "run" : "done";

    if (state.scan !== null && state.scan.state !== "done") {
      return { ...state, held: [...state.held, at] };
    }

    return readingStep(state, at, now);
  }

  if (step === "scan") {
    if (running) {
      return { ...state, scan: began(state.scan ?? { ...WAITING }, now) };
    }

    return scanEnded(state, now);
  }

  return state;
}

function withLanguage(
  languages: LanguageProgress[],
  name: string,
  patch: Partial<LanguageProgress>,
): LanguageProgress[] {
  const at = languages.findIndex((one) => one.name === name);

  if (at === -1) {
    return [...languages, { name, state: "waiting", files: null, ...patch }];
  }

  return languages.map((one, index) =>
    index === at ? { ...one, ...patch } : one,
  );
}

function feedOf(state: LoadingState, text: string, now: number) {
  const event = parseScanLine(text);

  if (event === null) {
    return state;
  }

  if (event.event === "phase" && event.phase === "extract") {
    if (event.state === "current") {
      return scanEnded(state, now);
    }

    return {
      ...state,
      languagesKnown: event.languages !== undefined,
      languages: (event.languages ?? []).reduce(
        (list, name) => withLanguage(list, name, {}),
        state.languages,
      ),
    };
  }

  if (event.event === "plugin" && event.phase === "extract") {
    const known = state.languages.find((one) => one.name === event.name);
    const data = event.data;

    if (data.event === "start") {
      return {
        ...state,
        languages: withLanguage(state.languages, event.name, {
          state: "reading",
          files: data.unit === "files" ? data.total : (known?.files ?? null),
        }),
      };
    }

    if (data.event === "progress" && data.unit === "files") {
      return {
        ...state,
        languages: withLanguage(state.languages, event.name, {
          state: "reading",
          files: data.total,
        }),
      };
    }

    return state;
  }

  if (event.event === "entry" && event.phase === "extract") {
    return {
      ...state,
      languages: withLanguage(state.languages, event.name, { state: "done" }),
    };
  }

  if (event.event === "structure") {
    const duplication: DuplicationProgress =
      event.state === "run"
        ? { state: "comparing", files: null }
        : { state: event.state, files: event.files };

    return { ...state, duplication };
  }

  return state;
}

export function loadingFill(state: LoadingState): number {
  const scanUnits = Math.max(1, state.languages.length);
  const total = state.scan === null ? 2 : 1 + scanUnits + 1 + 1;
  let done = state.survey.state === "done" ? 1 : 0;

  if (state.reading.state === "done") {
    done += 1;
  }

  if (state.scan !== null) {
    done +=
      state.scan.state === "done"
        ? scanUnits + 1
        : state.languages.filter((one) => one.state === "done").length +
          (state.duplication !== null && state.duplication.state !== "comparing"
            ? 1
            : 0);
  }

  return Math.min(1, done / total);
}

export function reduceLoading(
  state: LoadingState,
  text: string,
  now: number,
): LoadingState {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return state;
  }

  const line = parsed as { event?: unknown; step?: unknown; state?: unknown };
  const next =
    typeof parsed === "object" &&
    parsed !== null &&
    line.event === "step" &&
    typeof line.step === "string" &&
    typeof line.state === "string"
      ? stepOf(state, line.step, line.state, now)
      : feedOf(state, text, now);

  return { ...next, fill: Math.max(state.fill, loadingFill(next)) };
}

export function elapsedText(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;

  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);

  return `${minutes}m ${rest}s`;
}

export function timedText(row: Timed, now: number): string {
  if (row.startedAt === null) {
    return "";
  }

  return elapsedText((row.endedAt ?? now) - row.startedAt);
}

export function applyFill(
  commands: number | null,
  commandsDone: number,
  changesDone: number,
  changes: number,
): number {
  if (commands !== null && commands > 0) {
    return Math.min(1, commandsDone / commands);
  }

  return Math.min(1, changesDone / Math.max(1, changes));
}
