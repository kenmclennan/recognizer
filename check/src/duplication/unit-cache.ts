import { join } from "node:path";
import type { Io } from "../cli.js";
import type { DuplicationSettings } from "./findings.js";

export const PORT_VERSION = "1";

export interface CachedUnit {
  qualified: string;
  startLine: number;
  endLine: number;
  startIndex: number;
  endIndex: number;
  fingerprints: string[];
}

export interface CacheEntry {
  hash: string;
  grammar: string;
  min_lines: number;
  min_nodes: number;
  units: CachedUnit[];
}

export type UnitCache = Record<string, CacheEntry>;

export function unitCachePath(root: string): string {
  return join(root, ".recognizer", "cache", "duplication-units.json");
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isUnit(value: unknown): value is CachedUnit {
  const unit = value as Record<string, unknown> | null;

  return (
    typeof unit === "object" &&
    unit !== null &&
    typeof unit.qualified === "string" &&
    isNumber(unit.startLine) &&
    isNumber(unit.endLine) &&
    isNumber(unit.startIndex) &&
    isNumber(unit.endIndex) &&
    Array.isArray(unit.fingerprints) &&
    unit.fingerprints.every((item) => typeof item === "string")
  );
}

function isEntry(value: unknown): value is CacheEntry {
  const entry = value as Record<string, unknown> | null;

  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof entry.hash === "string" &&
    typeof entry.grammar === "string" &&
    isNumber(entry.min_lines) &&
    isNumber(entry.min_nodes) &&
    Array.isArray(entry.units) &&
    entry.units.every(isUnit)
  );
}

export function readUnitCache(io: Io, root: string): UnitCache {
  const path = unitCachePath(root);

  if (!io.exists(path)) {
    return {};
  }

  try {
    const parsed = JSON.parse(io.readFile(path)) as {
      port?: unknown;
      entries?: Record<string, unknown>;
    };

    if (parsed.port !== PORT_VERSION) {
      return {};
    }

    const entries = Object.entries(parsed.entries ?? {});

    if (!entries.every(([, entry]) => isEntry(entry))) {
      throw new Error("an entry has the wrong shape");
    }

    return Object.fromEntries(entries) as UnitCache;
  } catch (error) {
    io.stderr(
      `duplication: ignored the unreadable unit cache ${path}: ${(error as Error).message}\n`,
    );

    return {};
  }
}

export function writeUnitCache(io: Io, root: string, cache: UnitCache): void {
  const target = unitCachePath(root);
  const temp = `${target}.tmp`;

  try {
    io.writeFile(
      temp,
      `${JSON.stringify({ port: PORT_VERSION, entries: cache })}\n`,
    );
    io.rename(temp, target);
  } catch (error) {
    io.remove(temp);
    io.stderr(
      `duplication: could not write the unit cache: ${(error as Error).message}\n`,
    );
  }
}

export function reusable(
  entry: CacheEntry | undefined,
  hash: string | undefined,
  grammar: string,
  settings: DuplicationSettings,
): entry is CacheEntry {
  return (
    entry !== undefined &&
    hash !== undefined &&
    entry.hash === hash &&
    entry.grammar === grammar &&
    entry.min_lines === settings.min_lines &&
    entry.min_nodes === settings.min_nodes
  );
}
