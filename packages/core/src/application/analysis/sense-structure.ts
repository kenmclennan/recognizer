import { Finding } from "../../domain/finding.js";
import { violationText } from "../../domain/finding-text.js";
import type { PolicyRule, ViolatedRule } from "../../domain/policy-rule.js";
import { principleOf } from "../../domain/principles.js";
import type { Repository } from "../../domain/repository.js";
import type { SensorFindings } from "../../domain/sensor-findings.js";
import {
  STRUCTURE_SENSOR_VERSION,
  type StructureSettings,
} from "../../domain/structure-settings.js";
import type { Warning } from "../../domain/warning.js";
import { violationId } from "../history/settle-baseline.js";
import { longFunctionFindings } from "./long-function-findings.js";
import { type FolderMetrics, measureFolders } from "./measure-folders.js";
import { type ModuleMetrics, measureModules } from "./measure-modules.js";
import { orphanFindings } from "./orphan-findings.js";
import { privateImportsFindings } from "./private-imports-findings.js";
import { unusedExportsFindings } from "./unused-exports-findings.js";

export interface MeasuredFindings {
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

export function measuredModules(
  repository: Repository,
  policy: readonly PolicyRule[] | null,
): Set<string> {
  return new Set(repository.graphKeeping(policy).ids);
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

export function senseStructure(
  repository: Repository,
  policy: readonly PolicyRule[] | null,
  settings: StructureSettings,
  context: StructureContext,
  measured: MeasuredFindings = { duplication: null, complexity: null },
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

  const analysis = measureModules(repository, policy);

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
