export type Progress = "waiting" | "running" | "done";

export type Timed = {
  state: Progress;
  startedAt: number | null;
  endedAt: number | null;
};

export type LoadingState = {
  startedAt: number;
  survey: Timed;
  scan: Timed | null;
  reading: Timed;
  fill: number;
};

const WAITING: Timed = { state: "waiting", startedAt: null, endedAt: null };

export function startLoading(now: number): LoadingState {
  return {
    startedAt: now,
    survey: { ...WAITING },
    scan: null,
    reading: { ...WAITING },
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

function stepOf(
  state: LoadingState,
  step: string,
  phase: string,
  now: number,
): LoadingState {
  const running = phase === "run";
  const move = (row: Timed) => (running ? began(row, now) : finished(row, now));

  if (step === "survey") {
    return { ...state, survey: move(state.survey) };
  }

  if (step === "reading") {
    return { ...state, reading: move(state.reading) };
  }

  if (step === "scan") {
    return { ...state, scan: move(state.scan ?? { ...WAITING }) };
  }

  return state;
}

export function loadingFill(state: LoadingState): number {
  const total = state.scan === null ? 2 : 3;
  let done = state.survey.state === "done" ? 1 : 0;

  if (state.reading.state === "done") {
    done += 1;
  }

  if (state.scan?.state === "done") {
    done += 1;
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
      : state;

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
