export const PROGRESS_PREFIX = "recognizer-progress ";

export type SensorProgress =
  | { step: "coverage" }
  | { step: "mutants"; done: number; total: number };

export function parseProgressLine(line: string): SensorProgress | null {
  if (!line.startsWith(PROGRESS_PREFIX)) {
    return null;
  }

  let value: unknown;

  try {
    value = JSON.parse(line.slice(PROGRESS_PREFIX.length));
  } catch {
    return null;
  }

  if (typeof value !== "object" || value === null) {
    return null;
  }

  const { step, done, total } = value as Record<string, unknown>;

  if (step === "coverage") {
    return { step };
  }

  if (
    step === "mutants" &&
    Number.isInteger(done) &&
    Number.isInteger(total) &&
    (done as number) >= 0 &&
    (done as number) <= (total as number)
  ) {
    return { step, done: done as number, total: total as number };
  }

  return null;
}

export function stripProgress(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => !line.startsWith(PROGRESS_PREFIX))
    .join("\n");
}
