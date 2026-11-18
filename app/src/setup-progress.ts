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
