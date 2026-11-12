export const PROGRESS_PREFIX = "recognizer-progress ";

export type SensorProgress =
  | { step: "coverage"; suite?: string }
  | { step: "mutants"; suite?: string; done: number; total: number };

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

  const { step, done, total, suite } = value as Record<string, unknown>;

  if (suite !== undefined && (typeof suite !== "string" || suite === "")) {
    return null;
  }

  const named = suite === undefined ? {} : { suite };

  if (step === "coverage") {
    return { step, ...named };
  }

  if (
    step === "mutants" &&
    Number.isInteger(done) &&
    Number.isInteger(total) &&
    (done as number) >= 0 &&
    (done as number) <= (total as number)
  ) {
    return { step, ...named, done: done as number, total: total as number };
  }

  return null;
}

export function stripProgress(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => !line.startsWith(PROGRESS_PREFIX))
    .join("\n");
}
