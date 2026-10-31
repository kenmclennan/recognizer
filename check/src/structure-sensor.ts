import { type Analysis, analyse, type ModuleMetrics } from "./analyse.js";
import { violationId } from "./baseline.js";
import type { Config } from "./config-parse.js";
import { violationText } from "./findings.js";
import type { FindingRecord, FindingsDocument } from "./findings-document.js";
import { keptGraph } from "./graph.js";
import type { Policy } from "./policy.js";
import { collectViolations } from "./rules.js";
import type { Scan } from "./scan.js";

export const STRUCTURE_SENSOR_VERSION = "1";
export const DEFAULT_HUB_THRESHOLD = 10;

export interface StructureSettings {
  hub_threshold: number;
  warnings: { cycle: boolean; hub: boolean };
}

export interface StructureContext {
  commit: string;
  modified: boolean;
}

export interface StructureResult {
  document: FindingsDocument;
  metrics: ModuleMetrics[];
  unranked: number;
}

export const DEFAULT_STRUCTURE_SETTINGS: StructureSettings = {
  hub_threshold: DEFAULT_HUB_THRESHOLD,
  warnings: { cycle: true, hub: true },
};

export function resolveStructureSettings(
  config: Config | null,
  override?: number,
): StructureSettings | "off" {
  const entry = config?.sensors?.structure;

  if (entry === "off") {
    return "off";
  }

  const given = entry !== undefined && "command" in entry ? {} : (entry ?? {});

  return {
    hub_threshold:
      override ??
      given.hub_threshold ??
      DEFAULT_STRUCTURE_SETTINGS.hub_threshold,
    warnings: {
      cycle: given.warnings?.cycle ?? DEFAULT_STRUCTURE_SETTINGS.warnings.cycle,
      hub: given.warnings?.hub ?? DEFAULT_STRUCTURE_SETTINGS.warnings.hub,
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

  return `hub_threshold ${settings.hub_threshold}, cycle ${on(settings.warnings.cycle)}, hub ${on(settings.warnings.hub)}`;
}

function warningFinding(warning: Analysis["warnings"][number]): FindingRecord {
  if (warning.id === "cycle") {
    return {
      id: `cycle:${warning.evidence.modules.join(",")}`,
      kind: "cycle",
      severity: "warning",
      principle: warning.principle,
      summary: warning.summary,
      fix_pattern: warning.fix_pattern,
      evidence: {
        modules: warning.evidence.modules,
        edges: warning.evidence.edges,
      },
    };
  }

  return {
    id: `hub:${warning.evidence.module}`,
    kind: "hub",
    severity: "warning",
    principle: warning.principle,
    summary: warning.summary,
    fix_pattern: warning.fix_pattern,
    evidence: {
      modules: [warning.evidence.module],
      measures: {
        fan_in: warning.evidence.fan_in,
        fan_out: warning.evidence.fan_out,
        threshold: warning.evidence.threshold,
      },
    },
  };
}

export function structureSensor(
  scans: Scan[],
  policy: Policy | null,
  settings: StructureSettings,
  context: StructureContext,
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
          principle: "dependencies-follow-the-policy",
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

    const analysis = analyse(
      scan,
      { hub: settings.hub_threshold },
      policy?.ignore,
    );

    metrics.push(...analysis.metrics);

    for (const warning of analysis.warnings) {
      const enabled =
        warning.id === "cycle"
          ? settings.warnings.cycle
          : settings.warnings.hub;

      if (enabled) {
        add(warnings, warningFinding(warning));
      }
    }
  }

  return {
    document: {
      findings_version: 1,
      sensor: { name: "structure", version: STRUCTURE_SENSOR_VERSION },
      commit: context.commit,
      modified: context.modified,
      settings: {
        hub_threshold: settings.hub_threshold,
        warnings: { ...settings.warnings },
      },
      findings: [...findings, ...warnings],
    },
    metrics,
    unranked,
  };
}
