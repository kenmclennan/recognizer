import { SCAN_SCHEMA_VERSION, type Scan } from "recognizer";
import type { ScanReport } from "./scan-report";

export type LoadedScan = { file: string; scan: Scan };

export type Loaded = {
  modules: string[];
  scans: LoadedScan[];
  policy: string | null;
  notices: string[];
  blocking: string | null;
};

const EMPTY: Loaded = {
  modules: [],
  scans: [],
  policy: null,
  notices: [],
  blocking: null,
};

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

  if (version !== SCAN_SCHEMA_VERSION) {
    return `${file} has schema_version ${String(version)}; this viewer reads ${SCAN_SCHEMA_VERSION}`;
  }

  if (
    !isList(document.modules) ||
    !isList(document.edges) ||
    !isList(document.foreign)
  ) {
    return `${file} is not a scan: it lacks the modules, edges and foreign lists`;
  }

  return { file, scan: document as unknown as Scan };
}

export function loadScans(report: ScanReport): Loaded {
  if (report.status === "command-missing") {
    return { ...EMPTY, blocking: report.hint };
  }

  if (report.status === "config-invalid") {
    return { ...EMPTY, blocking: `config.json is invalid: ${report.message}` };
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

    for (const module of loaded.scan.modules) {
      if (!seen.has(module.id)) {
        seen.add(module.id);
        modules.push(module.id);
      }
    }
  }

  return { modules, scans, policy: report.policy, notices, blocking: null };
}
