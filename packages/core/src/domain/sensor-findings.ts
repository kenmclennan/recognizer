import type { Diagnosis } from "./diagnosis.js";
import type { Finding } from "./finding.js";

export type SuiteStatus = "ok" | "failed" | "partial" | "never";

export interface SuiteResult {
  readonly name: string;
  readonly status: SuiteStatus;
  readonly ranAt: string | null;
  readonly reason?: string;
  readonly measured?: number;
  readonly total?: number;
  readonly ran?: boolean;
}

export interface SensorWork {
  readonly unit: string;
  readonly performed: number;
  readonly reused: number;
}

export interface SensorCounts {
  readonly measured: number;
  readonly total: number;
}

export interface SensorExclusion {
  readonly functions: number;
  readonly files: readonly string[];
}

export interface SensorFindings {
  readonly sensor: { readonly name: string; readonly version: string };
  readonly commit: string;
  readonly modified: boolean;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly reportedAt?: string;
  readonly stopped?: SensorCounts;
  readonly partial?: SensorCounts;
  readonly counts?: SensorCounts;
  readonly excluded?: SensorExclusion;
  readonly unowned?: SensorExclusion;
  readonly findings: readonly Finding[];
  readonly inputs?: Readonly<Record<string, string>>;
  readonly tests?: string;
  readonly suites?: readonly SuiteResult[];
  readonly work?: SensorWork;
  readonly diagnosis?: Diagnosis;
}
