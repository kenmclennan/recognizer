import {
  type DocumentFreshness,
  type Finding,
  type PolicyRule,
  Repository,
  type SensorFindingsHeader,
} from "@recognizer/core";
import { readRepository } from "recognizer";
import type { OverlayFileInput } from "./overlay-model";
import type { ScanReport } from "./scan-report";
import type { SensorStatus } from "./sensor-run";

export type LoadedScan = { file: string; repository: Repository };

export type Loaded = {
  modules: string[];
  scans: LoadedScan[];
  repository: Repository;
  policy: PolicyRule[] | null;
  baseline: string[] | null;
  baselineProblem?: string | null;
  notices: string[];
  blocking: string | null;
  findings: SensorFindingsHeader[];
  sensors: SensorStatus[];
  overlays?: OverlayFileInput[];
  overlaysUnreadable?: string[];
  tests?: string | null;
  freshness?: Record<string, DocumentFreshness>;
  split: Record<string, { shown: Finding[]; hidden: Finding[] }>;
  lastRun?: string | null;
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

export function loadScans(report: ScanReport): Loaded {
  const notices = [...report.notices];
  const scans: LoadedScan[] = [];
  const seen = new Set<string>();
  const modules: string[] = [];

  for (const { file, document } of report.scans) {
    try {
      scans.push({
        file,
        repository: readRepositoryFiles([{ file, document }]),
      });
    } catch (error) {
      notices.push(`${file} is not a valid scan: ${(error as Error).message}`);
    }
  }

  for (const loaded of scans) {
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
    repository: Repository.join(scans.map((one) => one.repository)),
    policy: null,
    baseline: null,
    notices,
    blocking: null,
    findings: [],
    split: {},
    sensors: [],
  };
}
