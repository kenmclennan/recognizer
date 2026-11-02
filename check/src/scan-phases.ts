import { InputError } from "./errors.js";
import type { PhaseName } from "./run-log.js";

export const SCAN_USAGE =
  "recognizer scan [REPOSITORY] [--extract] [--describe[=all]] [--sense <all|name[,name...]>] [--by <name>] [--json]";

export interface ScanOptions {
  positionals: string[];
  extract: boolean;
  describe: false | "stale" | "all";
  sense: null | "all" | string[];
  json: boolean;
  by: string | undefined;
}

function usageError(message: string): InputError {
  return new InputError([message, `usage: ${SCAN_USAGE}`]);
}

function senseNames(value: string): "all" | string[] {
  if (value === "all") {
    return "all";
  }

  const names = value.split(",");

  if (names.some((name) => name.trim() === "")) {
    throw usageError("--sense names must not be empty");
  }

  return [...new Set(names)];
}

export function parseScanArgs(argv: string[]): ScanOptions {
  const options: ScanOptions = {
    positionals: [],
    extract: false,
    describe: false,
    sense: null,
    json: false,
    by: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;

    if (arg === "--extract") {
      options.extract = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--describe") {
      options.describe = "stale";
    } else if (arg.startsWith("--describe=")) {
      if (arg !== "--describe=all") {
        throw usageError(`--describe takes only =all, not ${arg.slice(11)}`);
      }

      options.describe = "all";
    } else if (arg === "--sense" || arg.startsWith("--sense=")) {
      const inline = arg.startsWith("--sense=");
      const value = inline ? arg.slice(8) : argv[index + 1];

      if (value === undefined || value === "" || value.startsWith("--")) {
        throw usageError("--sense needs all or a sensor name");
      }

      if (!inline) {
        index += 1;
      }

      options.sense = senseNames(value);
    } else if (arg === "--by" || arg.startsWith("--by=")) {
      const inline = arg.startsWith("--by=");
      const value = inline ? arg.slice(5) : argv[index + 1];

      if (value === undefined) {
        throw usageError("--by needs a name");
      }

      if (!inline) {
        index += 1;
      }

      options.by = value;
    } else if (arg.startsWith("-") && arg !== "-") {
      throw usageError(`unknown option: ${arg}`);
    } else {
      options.positionals.push(arg);
    }
  }

  if (options.positionals.length > 1) {
    throw usageError("scan takes at most one repository");
  }

  return options;
}

export function selectSensors<T extends { name: string }>(
  registered: T[],
  requested: "all" | string[],
): T[] {
  if (registered.length === 0) {
    throw new InputError([
      "no sensors are registered: add one to .recognizer/config.yaml",
    ]);
  }

  if (requested === "all") {
    return registered;
  }

  const names = registered.map((one) => one.name);
  const unknown = requested.filter((name) => !names.includes(name));

  if (unknown.length > 0) {
    throw new InputError([
      ...unknown.map((name) => `no such sensor: ${name}`),
      `registered sensors: ${names.join(", ")}`,
    ]);
  }

  return registered.filter((one) => requested.includes(one.name));
}

export interface CachedScan {
  commit: string | null;
  modified: boolean;
  scannerVersion: string;
}

export interface ExtractionState {
  force: boolean;
  commit: string | null;
  dirty: boolean;
  languages: {
    language: string;
    cachedScan: CachedScan | null;
    installedVersion: string | null;
  }[];
}

export type ExtractionDecision =
  | { run: true; reason: string }
  | { run: false; commit: string };

export function extractionPrecheck(
  state: Omit<ExtractionState, "languages"> & {
    languages: { language: string; cachedScan: CachedScan | null }[];
  },
): ExtractionDecision | null {
  if (state.force) {
    return { run: true, reason: "forced" };
  }

  if (state.commit === null) {
    return { run: true, reason: "no-commit" };
  }

  if (state.languages.length === 0) {
    return { run: true, reason: "no-languages" };
  }

  for (const { language, cachedScan } of state.languages) {
    if (cachedScan === null) {
      return { run: true, reason: `no-scan:${language}` };
    }
  }

  for (const { cachedScan } of state.languages) {
    if (cachedScan?.commit !== state.commit) {
      return { run: true, reason: "commit-changed" };
    }
  }

  if (state.dirty || state.languages.some((one) => one.cachedScan?.modified)) {
    return { run: true, reason: "dirty" };
  }

  return null;
}

export function extractionNeeded(state: ExtractionState): ExtractionDecision {
  const early = extractionPrecheck(state);

  if (early !== null) {
    return early;
  }

  for (const { language, cachedScan, installedVersion } of state.languages) {
    if (installedVersion === null) {
      return { run: true, reason: `scanner-unavailable:${language}` };
    }

    if (cachedScan?.scannerVersion !== installedVersion) {
      return { run: true, reason: `scanner-version:${language}` };
    }
  }

  return { run: false, commit: state.commit as string };
}

export interface EventEntry {
  name: string;
  outcome: "ok" | "failed";
  reason?: string;
  modules?: number;
  edges?: number;
}

export function phaseLine(
  phase: PhaseName,
  detail:
    | { state: "run"; commit: string | null; reason: string }
    | { state: "current"; commit: string }
    | { total: number },
): string {
  return `${JSON.stringify({ event: "phase", phase, ...detail })}\n`;
}

export function entryLine(phase: PhaseName, entry: EventEntry): string {
  return `${JSON.stringify({ event: "entry", phase, ...entry })}\n`;
}

export function summaryLine(summary: {
  repository: string;
  commit: string | null;
  modified: boolean | null;
  exit: 0 | 1;
  phases: { phase: PhaseName; entries: EventEntry[] }[];
  removed: string[];
}): string {
  return `${JSON.stringify({ event: "summary", ...summary })}\n`;
}
