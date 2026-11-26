import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const LANGUAGE = "typescript";
export const KEY = "run";
export const KEPT_RUNS = 5;
export const MOVE_MS = 1000;

export type Clock = () => number;

export interface Run {
  key: string;
  ms: number;
  units: number;
}

export function awakeClock(): Clock {
  const origin = process.hrtime.bigint();

  return () => Number(process.hrtime.bigint() - origin) / 1e6;
}

function cacheFolder(root: string): string {
  return join(root, ".recognizer", "cache");
}

export function historyPath(root: string): string {
  return join(cacheFolder(root), `scan-${LANGUAGE}`, "history.json");
}

function validRun(item: unknown): item is Run {
  if (typeof item !== "object" || item === null) {
    return false;
  }

  const run = item as Record<string, unknown>;

  return (
    typeof run.key === "string" &&
    typeof run.ms === "number" &&
    typeof run.units === "number"
  );
}

export function readAll(root: string): Run[] | null {
  let text: string;

  try {
    text = readFileSync(historyPath(root), "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : null;
  }

  let document: unknown;

  try {
    document = JSON.parse(text);
  } catch {
    return null;
  }

  const runs = (document as { runs?: unknown } | null)?.runs;

  return Array.isArray(runs) ? runs.filter(validRun) : null;
}

export function readRuns(root: string): Run[] {
  return (readAll(root) ?? []).filter((run) => run.key === KEY);
}

function ensureCacheIgnore(root: string): void {
  const folder = cacheFolder(root);

  mkdirSync(folder, { recursive: true });

  try {
    writeFileSync(join(folder, ".gitignore"), "*\n", { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}

export function recordRun(root: string, ms: number, units: number): void {
  const runs = readAll(root);

  if (runs === null) {
    return;
  }

  runs.push({ key: KEY, ms, units });

  const path = historyPath(root);
  const staged = `${path}.${process.pid}.tmp`;

  try {
    ensureCacheIgnore(root);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(staged, JSON.stringify({ runs: runs.slice(-KEPT_RUNS) }));
    renameSync(staged, path);
  } catch {
    rmSync(staged, { force: true });
  }
}

export function scaledEstimate(
  runs: Run[],
  total: number,
  elapsedMs: number,
): number | null {
  const rates = runs
    .filter((run) => run.units > 0)
    .map((run) => run.ms / run.units);

  if (rates.length === 0 || total <= 0) {
    return null;
  }

  rates.sort((a, b) => a - b);

  const middle = Math.floor(rates.length / 2);
  const rate =
    rates.length % 2 === 1
      ? (rates[middle] ?? 0)
      : ((rates[middle - 1] ?? 0) + (rates[middle] ?? 0)) / 2;
  const projected = rate * total;

  return elapsedMs > projected ? null : Math.trunc(projected - elapsedMs);
}
