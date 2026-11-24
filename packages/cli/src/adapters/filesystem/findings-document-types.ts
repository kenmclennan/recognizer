export type DocumentRule =
  | { type: "level"; from_level: string; to_level: string }
  | { type: "uses"; from_component: string; to_component: string }
  | { type: "forbid"; pattern: string };

export interface DocumentEdge {
  from: string;
  to: string;
  kind?: string;
  lines?: number[];
  rules?: unknown[];
}

export interface DocumentTestImporter {
  file: string;
  names: string[];
}

export interface DocumentFindingMember {
  module: string;
  name: string;
  file?: string;
  lines?: [number, number];
  test_files?: string[];
}

export interface FindingRecord {
  id: string;
  kind: string;
  severity: "violation" | "warning";
  principle: string;
  citation?: {
    author: string;
    work: string;
    year: number;
    locator?: string;
  };
  summary: string;
  fix_pattern?: string;
  metric?: string;
  evidence: {
    modules: string[];
    edges?: DocumentEdge[];
    members?: DocumentFindingMember[];
    measures?: Record<string, number>;
    test_importers?: DocumentTestImporter[];
    producer?: string;
  };
}

export interface DocumentSuite {
  name: string;
  status: "ok" | "failed" | "partial" | "never";
  ran_at: string | null;
  reason?: string;
  measured?: number;
  total?: number;
  ran?: boolean;
}

export interface DocumentDiagnosis {
  code: string;
  line: string;
  suite?: string;
  fix?: string;
  failing?: { count?: number; names: string[] };
  unmeasured?: boolean;
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
  unknown_files?: { languages: string[]; files: string[] };
  findings: FindingRecord[];
  inputs?: Record<string, string>;
  tests?: string;
  suites?: DocumentSuite[];
  work?: { unit: string; performed: number; reused: number };
  diagnosis?: DocumentDiagnosis;
}
