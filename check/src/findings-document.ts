import validate from "./generated/findings-validator.js";
import type { Diagnosis } from "./plugin-events.js";
import type { Citation } from "./principles.js";
import type { Rule } from "./rules.js";

export interface FindingEdge {
  from: string;
  to: string;
  kind?: string;
  lines?: number[];
  rules?: Rule[];
}

export interface FindingRecord {
  id: string;
  kind: string;
  severity: "violation" | "warning";
  principle: string;
  citation?: Citation;
  summary: string;
  fix_pattern?: string;
  metric?: string;
  evidence: {
    modules: string[];
    edges?: FindingEdge[];
    members?: {
      module: string;
      name: string;
      file?: string;
      lines?: [number, number];
      test_files?: string[];
    }[];
    measures?: Record<string, number>;
    test_importers?: TestImporter[];
    producer?: string;
  };
}

export interface TestImporter {
  file: string;
  names: string[];
}

export type SuiteStatus = "ok" | "failed" | "partial" | "never";

export interface SuiteResult {
  name: string;
  status: SuiteStatus;
  ran_at: string | null;
  reason?: string;
  measured?: number;
  total?: number;
  ran?: boolean;
}

export interface FindingsWork {
  unit: string;
  performed: number;
  reused: number;
}

export interface FindingsDocument {
  findings_version: 1 | 2;
  sensor: { name: string; version: string };
  commit: string;
  modified: boolean;
  settings: Record<string, unknown>;
  reported_at?: string;
  stopped?: { measured: number; total: number };
  partial?: { measured: number; total: number };
  counts?: { measured: number; total: number };
  excluded?: { functions: number; modules: string[] };
  unowned?: { functions: number; modules: string[] };
  findings: FindingRecord[];
  inputs?: Record<string, string>;
  tests?: string;
  suites?: SuiteResult[];
  work?: FindingsWork;
  diagnosis?: Diagnosis;
}

export interface ExpectedSensor {
  name?: string;
  commit?: string;
}

export function validateFindings(
  value: unknown,
  expected: ExpectedSensor = {},
): FindingsDocument {
  if (!validate(value)) {
    const first = validate.errors?.[0];

    throw new Error(
      first === undefined
        ? "findings are invalid"
        : `findings${first.instancePath} ${first.message ?? "is invalid"}`,
    );
  }

  const document = value as unknown as FindingsDocument;
  const seen = new Set<string>();

  for (const finding of document.findings) {
    if (seen.has(finding.id)) {
      throw new Error(`findings repeat the id ${finding.id}`);
    }

    seen.add(finding.id);
  }

  if (expected.name !== undefined && document.sensor.name !== expected.name) {
    throw new Error(
      `findings are from sensor ${document.sensor.name}, not ${expected.name}`,
    );
  }

  if (expected.commit !== undefined && document.commit !== expected.commit) {
    throw new Error(
      `findings commit ${document.commit} is not the repository's ${expected.commit}`,
    );
  }

  return document;
}
