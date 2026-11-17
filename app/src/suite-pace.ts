import type { RunWork } from "./scan-progress";

export const SUITES_UNIT = "suites";

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export type SuitePace = {
  left: number;
  overran: string[];
};

function isFinished(runWork: RunWork, name: string): boolean {
  const step = runWork.steps[name];

  if (step === undefined) {
    return false;
  }

  return (
    runWork.current !== name ||
    (runWork.unit === SUITES_UNIT && step.latest > step.first)
  );
}

export function suitePace(
  names: readonly string[],
  history: Record<string, number[]> | undefined,
  runWork: RunWork | null,
  now: number,
): SuitePace | null {
  if (
    runWork === null ||
    runWork.at === null ||
    runWork.current === null ||
    names.length < 2 ||
    history === undefined
  ) {
    return null;
  }

  const medians = new Map<string, number>();

  for (const name of names) {
    const past = history[name];

    if (past !== undefined && past.length > 0) {
      medians.set(name, median(past));
    }
  }

  if (medians.size === 0) {
    return null;
  }

  const finished = names.filter((name) => isFinished(runWork, name));
  const actual = (name: string) =>
    (runWork.steps[name]?.lastAt ?? 0) - (runWork.steps[name]?.firstAt ?? 0);
  const compared = finished.filter((name) => medians.has(name));
  const expected = compared.reduce(
    (sum, name) => sum + (medians.get(name) as number),
    0,
  );
  const ratio =
    expected > 0
      ? compared.reduce((sum, name) => sum + actual(name), 0) / expected
      : 1;
  const countPace =
    finished.length > 0
      ? (now - runWork.at) / finished.length
      : ([...medians.values()].reduce((sum, one) => sum + one, 0) /
          medians.size) *
        ratio;

  let left = 0;
  const overran: string[] = [];

  for (const name of names) {
    if (finished.includes(name)) {
      continue;
    }

    const typical = medians.get(name);
    const step = runWork.steps[name];

    if (step === undefined) {
      left += typical === undefined ? countPace : typical * ratio;

      continue;
    }

    const elapsed = now - step.firstAt;

    if (typical === undefined) {
      left += Math.max(0, countPace - elapsed);

      continue;
    }

    if (elapsed <= typical) {
      left += (typical - elapsed) * ratio;

      continue;
    }

    const longer = (history[name] ?? []).filter((one) => one >= elapsed);

    if (longer.length === 0) {
      overran.push(name);

      continue;
    }

    left += Math.max(0, median(longer) - elapsed);
  }

  return { left, overran };
}
