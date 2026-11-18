export type Progress = "waiting" | "running" | "done";

export type Timed = {
  state: Progress;
  startedAt: number | null;
  endedAt: number | null;
};

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
