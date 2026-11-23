import {
  EMPTY_REPOSITORY,
  joinRepositories,
  type Repository,
  type SensorFindings,
} from "@recognizer/core";
import {
  judgeScanVersion,
  readRepository,
  SCAN_SCHEMA_VERSION,
} from "recognizer";
import type { ScanHistory } from "./scan-estimate";
import type { ScanReport } from "./scan-report";
import type { SensorStatus } from "./sensor-run";

export type LoadedScan = { file: string; repository: Repository };

export type Loaded = {
  modules: string[];
  scans: LoadedScan[];
  repository: Repository;
  policy: string | null;
  baseline: string | null;
  notices: string[];
  blocking: string | null;
  findings: SensorFindings[];
  sensors: SensorStatus[];
  overlays?: { name: string; text: string; modifiedMs?: number | null }[];
  overlaysUnreadable?: string[];
  tests?: string | null;
  history?: ScanHistory;
};

const EMPTY: Loaded = {
  modules: [],
  scans: [],
  repository: EMPTY_REPOSITORY,
  policy: null,
  baseline: null,
  notices: [],
  blocking: null,
  findings: [],
  sensors: [],
};

export function readRepositoryFiles(
  documents: { file: string; document: unknown }[],
): Repository {
  return readRepository(
    documents.map(({ file, document }) => ({
      language:
        /^scan\.(.+)\.json$/.exec(file.split("/").pop() ?? "")?.[1] ??
        "unknown",
      document,
    })),
  );
}

function isList(value: unknown): boolean {
  return Array.isArray(value);
}

function parseScan(file: string, text: string): LoadedScan | string {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return `${file} is not valid JSON: ${(error as Error).message}`;
  }

  const document = parsed as Record<string, unknown> | null;
  const version = document?.schema_version;

  if (typeof document !== "object" || document === null) {
    return `${file} is not a scan document`;
  }

  const refused =
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    ["newer", "broken"].includes(judgeScanVersion(version));

  if (refused) {
    return `${file} has schema_version ${String(version)}; this viewer reads ${SCAN_SCHEMA_VERSION}`;
  }

  if (
    !isList(document.modules) ||
    !isList(document.edges) ||
    !isList(document.foreign)
  ) {
    return `${file} is not a scan: it lacks the files, edges and foreign lists`;
  }

  try {
    return { file, repository: readRepositoryFiles([{ file, document }]) };
  } catch (error) {
    return `${file} is not a valid scan: ${(error as Error).message}`;
  }
}

export function loadScans(report: ScanReport): Loaded {
  if (report.status === "command-missing") {
    return { ...EMPTY, blocking: report.hint };
  }

  if (report.status === "scan-failed") {
    return {
      ...EMPTY,
      blocking: `recognizer scan failed (exit ${report.exitCode}): ${report.stderr.trim()}`,
    };
  }

  const notices: string[] = [];
  const scans: LoadedScan[] = [];
  const seen = new Set<string>();
  const modules: string[] = [];

  if (report.exitCode !== 0) {
    notices.push(
      `recognizer scan exited ${report.exitCode}: ${report.stderr.trim()}`,
    );
  }

  for (const { file, text } of report.scans) {
    const loaded = parseScan(file, text);

    if (typeof loaded === "string") {
      notices.push(loaded);
      continue;
    }

    scans.push(loaded);

    for (const file of loaded.repository.files) {
      if (!seen.has(file.path)) {
        seen.add(file.path);
        modules.push(file.path);
      }
    }
  }

  return {
    modules,
    scans,
    repository: joinRepositories(scans.map((one) => one.repository)),
    policy: report.policy,
    baseline: report.baseline ?? null,
    notices,
    blocking: null,
    findings: [],
    sensors: [],
  };
}
