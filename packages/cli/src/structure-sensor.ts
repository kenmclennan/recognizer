import {
  Finding,
  type PolicyRule,
  type Repository,
  type SensorFindings,
  type ViolatedRule,
  type Warning,
} from "@recognizer/core";
import { analyse, type ModuleMetrics } from "./analyse.js";
import { violationId } from "./baseline.js";
import type { Config } from "./config-parse.js";
import {
  DEFAULT_DUPLICATION_SETTINGS,
  type DuplicationSettings,
} from "./duplication/findings.js";
import { violationText } from "./findings.js";
import { type FolderMetrics, measureFolders } from "./folder-metrics.js";
import { COMPLEXITY_LIMIT, LONG_FUNCTION } from "./function-length.js";
import { principleOf } from "./principles.js";
import {
  longFunctionFindings,
  orphanFindings,
  privateImportsFindings,
  unusedExportsFindings,
} from "./structure-warnings.js";

export const STRUCTURE_SENSOR_VERSION = "23";

export interface StructureSettings {
  duplication: false | DuplicationSettings;
  entry_points: string[];
  entry_annotations: string[];
  warnings: {
    cycle: boolean;
    orphan: boolean;
    unused_exports: boolean;
    private_imports: boolean;
    long_function: boolean;
    complexity: boolean;
  };
  long_function_limit: number;
  complexity_limit: number;
}

export interface Measured {
  duplication: Finding[] | null;
  complexity: Finding[] | null;
}

export interface StructureContext {
  commit: string;
  modified: boolean;
}

export interface StructureResult {
  document: SensorFindings;
  metrics: ModuleMetrics[];
  folder_metrics: FolderMetrics[];
}

export const DEFAULT_STRUCTURE_SETTINGS: StructureSettings = {
  duplication: { ...DEFAULT_DUPLICATION_SETTINGS },
  entry_points: [],
  entry_annotations: [],
  warnings: {
    cycle: true,
    orphan: true,
    unused_exports: false,
    private_imports: true,
    long_function: true,
    complexity: true,
  },
  long_function_limit: LONG_FUNCTION,
  complexity_limit: COMPLEXITY_LIMIT,
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
  const longFunction = given.warnings?.long_function ?? true;
  const complexity = given.warnings?.complexity ?? true;

  const duplication = given.duplication;

  return {
    duplication:
      duplication === false
        ? false
        : { ...DEFAULT_DUPLICATION_SETTINGS, ...(duplication ?? {}) },
    entry_points:
      typeof orphan === "object" ? [...(orphan.entry_points ?? [])] : [],
    entry_annotations:
      typeof orphan === "object" ? [...(orphan.entry_annotations ?? [])] : [],
    warnings: {
      cycle: given.warnings?.cycle ?? defaults.cycle,
      orphan: orphan !== false,
      unused_exports: given.warnings?.unused_exports ?? defaults.unused_exports,
      private_imports:
        given.warnings?.private_imports ?? defaults.private_imports,
      long_function: longFunction !== false,
      complexity: complexity !== false,
    },
    long_function_limit:
      typeof longFunction === "object"
        ? longFunction.limit
        : DEFAULT_STRUCTURE_SETTINGS.long_function_limit,
    complexity_limit:
      typeof complexity === "object"
        ? complexity.limit
        : DEFAULT_STRUCTURE_SETTINGS.complexity_limit,
  };
}

export function measuredModules(
  repository: Repository,
  policy: readonly PolicyRule[] | null,
): Set<string> {
  return new Set(repository.graphKeeping(policy).ids);
}

export function describeSettings(settings: StructureSettings): string {
  const on = (value: boolean) => (value ? "on" : "off");

  const w = settings.warnings;
  const entries =
    settings.entry_points.length > 0
      ? `, entry_points ${settings.entry_points.length}`
      : "";
  const annotations =
    settings.entry_annotations.length > 0
      ? `, entry_annotations ${settings.entry_annotations.length}`
      : "";

  return `cycle ${on(w.cycle)}, orphan ${on(w.orphan)}, unused_exports ${on(w.unused_exports)}, private_imports ${on(w.private_imports)}, long_function ${on(w.long_function)}, long_function_limit ${settings.long_function_limit}, complexity ${on(w.complexity)}, complexity_limit ${settings.complexity_limit}${entries}${annotations}`;
}

export function violationPrinciple(rules: readonly ViolatedRule[]): string {
  return rules.some((rule) => rule.type === "level")
    ? "dependency-inversion-principle"
    : "repository-policy";
}

function warningFinding(warning: Warning): Finding {
  return Finding.stored({
    id: `cycle:${warning.files.join(",")}`,
    kind: "cycle",
    severity: "warning",
    ...principleOf(warning.principle),
    summary: warning.summary,
    fixPattern: warning.fixPattern,
    files: warning.files,
    dependencies: warning.dependencies,
  });
}

export function measuredInputs(repository: Repository): Record<string, string> {
  const inputs: Record<string, string> = {};
  const hashes = repository.scannedHashes();

  for (const file of repository.files) {
    const hash = hashes.get(file.path);

    if (hash !== undefined) {
      inputs[file.path] = hash;
    }
  }

  return Object.fromEntries(
    Object.entries(inputs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

export function structureSensor(
  repository: Repository,
  policy: readonly PolicyRule[] | null,
  settings: StructureSettings,
  context: StructureContext,
  measured: Measured = { duplication: null, complexity: null },
): StructureResult {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const metrics: ModuleMetrics[] = [];
  const warnings: Finding[] = [];

  const add = (target: Finding[], finding: Finding) => {
    if (!seen.has(finding.id)) {
      seen.add(finding.id);
      target.push(finding);
    }
  };

  if (policy !== null) {
    for (const violation of repository.violations(policy)) {
      add(
        findings,
        Finding.stored({
          id: violationId(violation),
          kind: "rule-violation",
          severity: "violation",
          ...principleOf(violationPrinciple([violation.rule])),
          summary: violationText(violation),
          files: [violation.file],
          dependencies: violation.dependencies.map((one) => ({
            from: violation.file,
            to: one.to,
            kind: one.kind,
            lines: one.lines,
            rules: [violation.rule],
          })),
        }),
      );
    }
  }

  const analysis = analyse(repository, policy);

  metrics.push(...analysis.metrics);

  if (settings.warnings.cycle) {
    for (const warning of repository.cycleWarnings(policy ?? [])) {
      add(warnings, warningFinding(warning));
    }
  }

  const extra = [
    ...(settings.warnings.orphan
      ? orphanFindings(
          repository,
          policy,
          settings.entry_points,
          settings.entry_annotations,
        )
      : []),
    ...(settings.warnings.unused_exports
      ? unusedExportsFindings(repository, policy, settings.entry_points)
      : []),
    ...(settings.warnings.private_imports
      ? privateImportsFindings(repository, policy)
      : []),
    ...(settings.warnings.long_function
      ? longFunctionFindings(repository, policy, settings.long_function_limit)
      : []),
  ];

  for (const finding of extra) {
    add(warnings, finding);
  }

  const folders = measureFolders(repository, policy);

  return {
    document: {
      sensor: { name: "structure", version: STRUCTURE_SENSOR_VERSION },
      commit: context.commit,
      modified: context.modified,
      settings: {
        entry_points: [...settings.entry_points],
        entry_annotations: [...settings.entry_annotations],
        warnings: {
          cycle: settings.warnings.cycle,
          orphan: settings.warnings.orphan,
          unused_exports: settings.warnings.unused_exports,
          private_imports: settings.warnings.private_imports,
          long_function: settings.warnings.long_function,
          complexity: settings.warnings.complexity,
        },
        long_function_limit: settings.long_function_limit,
        ...(measured.complexity !== null
          ? { complexity_limit: settings.complexity_limit }
          : {}),
        ...(measured.duplication !== null && settings.duplication !== false
          ? { duplication: { ...settings.duplication } }
          : {}),
      },
      findings: [
        ...findings,
        ...warnings,
        ...(measured.duplication ?? []),
        ...(measured.complexity ?? []),
      ],
      inputs: measuredInputs(repository),
    },
    metrics,
    folder_metrics: folders.rows,
  };
}
