import { type Analysis, analyse, type ModuleMetrics } from "./analyse.js";
import { violationId } from "./baseline.js";
import type { Config } from "./config-parse.js";
import {
  DEFAULT_DUPLICATION_SETTINGS,
  type DuplicationSettings,
} from "./duplication/findings.js";
import { violationText } from "./findings.js";
import type { FindingRecord, FindingsDocument } from "./findings-document.js";
import { type FolderMetrics, measureFolders } from "./folder-metrics.js";
import { keptGraph } from "./graph.js";
import type { Policy } from "./policy.js";
import { principleOf } from "./principles.js";
import { collectViolations, type Rule } from "./rules.js";
import type { RecordedScan, Scan } from "./scan.js";
import {
  longFunctionFindings,
  orphanFindings,
  privateImportsFindings,
  unusedExportsFindings,
} from "./structure-warnings.js";

export const STRUCTURE_SENSOR_VERSION = "18";

export interface StructureSettings {
  duplication: false | DuplicationSettings;
  entry_points: string[];
  warnings: {
    cycle: boolean;
    orphan: boolean;
    unused_exports: boolean;
    private_imports: boolean;
    long_function: boolean;
  };
}

export interface StructureContext {
  commit: string;
  modified: boolean;
}

export interface StructureResult {
  document: FindingsDocument;
  metrics: ModuleMetrics[];
  folder_metrics: FolderMetrics[];
  unranked: number;
}

export const DEFAULT_STRUCTURE_SETTINGS: StructureSettings = {
  duplication: { ...DEFAULT_DUPLICATION_SETTINGS },
  entry_points: [],
  warnings: {
    cycle: true,
    orphan: true,
    unused_exports: false,
    private_imports: true,
    long_function: true,
  },
};

export function resolveStructureSettings(
  config: Config | null,
): StructureSettings | "off" {
  const entry = config?.sensors?.structure;

  if (entry === "off") {
    return "off";
  }

  const given = entry !== undefined && "command" in entry ? {} : (entry ?? {});

  const defaults = DEFAULT_STRUCTURE_SETTINGS.warnings;
  const orphan = given.warnings?.orphan ?? true;

  const duplication = given.duplication;

  return {
    duplication:
      duplication === false
        ? false
        : { ...DEFAULT_DUPLICATION_SETTINGS, ...(duplication ?? {}) },
    entry_points: typeof orphan === "object" ? [...orphan.entry_points] : [],
    warnings: {
      cycle: given.warnings?.cycle ?? defaults.cycle,
      orphan: orphan !== false,
      unused_exports: given.warnings?.unused_exports ?? defaults.unused_exports,
      private_imports:
        given.warnings?.private_imports ?? defaults.private_imports,
      long_function: given.warnings?.long_function ?? defaults.long_function,
    },
  };
}

export function measuredModules(
  scans: Scan[],
  policy: Policy | null,
): Set<string> {
  const measured = new Set<string>();

  for (const scan of scans) {
    for (const id of keptGraph(scan, policy?.ignore ?? []).ids) {
      measured.add(id);
    }
  }

  return measured;
}

export function describeSettings(settings: StructureSettings): string {
  const on = (value: boolean) => (value ? "on" : "off");

  const w = settings.warnings;
  const entries =
    settings.entry_points.length > 0
      ? `, entry_points ${settings.entry_points.length}`
      : "";

  return `cycle ${on(w.cycle)}, orphan ${on(w.orphan)}, unused_exports ${on(w.unused_exports)}, private_imports ${on(w.private_imports)}, long_function ${on(w.long_function)}${entries}`;
}

export function violationPrinciple(rules: readonly Rule[]): string {
  return rules.some((rule) => rule.type === "level")
    ? "dependency-inversion-principle"
    : "repository-policy";
}

function warningFinding(warning: Analysis["warnings"][number]): FindingRecord {
  return {
    id: `cycle:${warning.evidence.modules.join(",")}`,
    kind: "cycle",
    severity: "warning",
    ...principleOf(warning.principle),
    summary: warning.summary,
    fix_pattern: warning.fix_pattern,
    evidence: {
      modules: warning.evidence.modules,
      edges: warning.evidence.edges,
    },
  };
}

export function measuredInputs(scans: Scan[]): Record<string, string> {
  const inputs: Record<string, string> = {};

  for (const scan of scans) {
    const hashes = new Map(
      ((scan as Partial<RecordedScan>).files ?? []).map((file) => [
        file.path,
        file.hash,
      ]),
    );

    for (const module of scan.modules) {
      const hash = hashes.get(module.id);

      if (hash !== undefined) {
        inputs[module.id] = hash;
      }
    }
  }

  return Object.fromEntries(
    Object.entries(inputs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

export function structureSensor(
  scans: Scan[],
  policy: Policy | null,
  settings: StructureSettings,
  context: StructureContext,
  duplication: FindingRecord[] | null = null,
): StructureResult {
  const findings: FindingRecord[] = [];
  const seen = new Set<string>();
  const metrics: ModuleMetrics[] = [];
  const warnings: FindingRecord[] = [];
  let unranked = 0;

  const add = (target: FindingRecord[], finding: FindingRecord) => {
    if (!seen.has(finding.id)) {
      seen.add(finding.id);
      target.push(finding);
    }
  };

  for (const scan of scans) {
    if (policy !== null) {
      const collected = collectViolations(scan, policy);

      unranked += collected.unranked;

      for (const violation of collected.violations) {
        add(findings, {
          id: violationId(violation),
          kind: "rule-violation",
          severity: "violation",
          ...principleOf(violationPrinciple(violation.rules)),
          summary: violationText(violation),
          evidence: {
            modules: [violation.from],
            edges: [
              {
                from: violation.from,
                to: violation.to,
                kind: violation.kind,
                lines: violation.lines,
                rules: violation.rules,
              },
            ],
          },
        });
      }
    }

    const analysis = analyse(scan, policy?.ignore);

    metrics.push(...analysis.metrics);

    for (const warning of analysis.warnings) {
      if (settings.warnings.cycle) {
        add(warnings, warningFinding(warning));
      }
    }

    const extra = [
      ...(settings.warnings.orphan
        ? orphanFindings(scan, policy, settings.entry_points)
        : []),
      ...(settings.warnings.unused_exports
        ? unusedExportsFindings(scan, policy, settings.entry_points)
        : []),
      ...(settings.warnings.private_imports
        ? privateImportsFindings(scan, policy)
        : []),
      ...(settings.warnings.long_function
        ? longFunctionFindings(scan, policy)
        : []),
    ];

    for (const finding of extra) {
      add(warnings, finding);
    }
  }

  const folders = measureFolders(scans, policy);

  return {
    document: {
      findings_version: 2,
      sensor: { name: "structure", version: STRUCTURE_SENSOR_VERSION },
      commit: context.commit,
      modified: context.modified,
      settings: {
        entry_points: [...settings.entry_points],
        warnings: {
          cycle: settings.warnings.cycle,
          orphan: settings.warnings.orphan,
          unused_exports: settings.warnings.unused_exports,
          private_imports: settings.warnings.private_imports,
          long_function: settings.warnings.long_function,
        },
        ...(duplication !== null && settings.duplication !== false
          ? { duplication: { ...settings.duplication } }
          : {}),
      },
      findings: [...findings, ...warnings, ...(duplication ?? [])],
      inputs: measuredInputs(scans),
    },
    metrics,
    folder_metrics: folders.rows,
    unranked,
  };
}
