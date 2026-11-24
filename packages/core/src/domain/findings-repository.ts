import type { Finding } from "./finding.js";
import type { Repository } from "./repository.js";
import type { Measured } from "./scan-plan.js";
import type { SensorFindings } from "./sensor-findings.js";
import type { UnitCache } from "./unit-cache.js";

export type StoredFindings =
  | { name: string; status: "read"; document: SensorFindings }
  | { name: string; status: "invalid"; reason: string };

export interface StructureOverlayInput {
  commit: string;
  modified: boolean;
  repository: Repository;
  complexity: Record<string, number> | null;
  functionLength: Record<string, number>;
  duplication: Finding[] | null;
}

export interface UnitCacheRead {
  cache: UnitCache;
  problem: string | null;
}

export interface ReportedFindings {
  name: string;
  version: string;
  commit: string;
  modified: boolean;
  reportedAt: string;
  findings: unknown;
  inputs: Record<string, string>;
}

export interface FindingsRepository {
  measuredOf(root: string, sensor: string): Measured | null;
  discardAnalysis(root: string, off: boolean): void;
  readAll(root: string): StoredFindings[];
  readStructure(root: string): SensorFindings | null;
  save(root: string, document: SensorFindings): void;
  remove(root: string, sensor: string): void;
  readUnitCache(root: string): UnitCacheRead;
  writeUnitCache(root: string, cache: UnitCache): string | null;
  saveStructureOverlay(root: string, input: StructureOverlayInput): void;
  documentOfReport(report: ReportedFindings): SensorFindings;
}
