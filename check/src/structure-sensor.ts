import { type Analysis, analyse, type ModuleMetrics } from "./analyse.js";
import { violationId } from "./baseline.js";
import type { Config } from "./config-parse.js";
import { violationText } from "./findings.js";
import type { FindingRecord, FindingsDocument } from "./findings-document.js";
import { keptGraph } from "./graph.js";
import type { Policy } from "./policy.js";
import { collectViolations } from "./rules.js";
import type { Scan } from "./scan.js";
import {
  folderCycleFindings,
  orphanFindings,
  policyDriftFindings,
} from "./structure-warnings.js";

export const STRUCTURE_SENSOR_VERSION = "2";
export const DEFAULT_HUB_THRESHOLD = 10;

export interface StructureSettings {
  hub_threshold: number;
  entry_points: string[];
  warnings: {
    cycle: boolean;
    hub: boolean;
    folder_cycle: boolean;
    orphan: boolean;
    policy_drift: boolean;
  };
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
  entry_points: [],
  warnings: {
    cycle: true,
    hub: true,
    folder_cycle: true,
    orphan: true,
    policy_drift: true,
  },
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

  const defaults = DEFAULT_STRUCTURE_SETTINGS.warnings;
  const orphan = given.warnings?.orphan ?? true;

  return {
    hub_threshold:
      override ??
      given.hub_threshold ??
      DEFAULT_STRUCTURE_SETTINGS.hub_threshold,
    entry_points: typeof orphan === "object" ? [...orphan.entry_points] : [],
    warnings: {
      cycle: given.warnings?.cycle ?? defaults.cycle,
      hub: given.warnings?.hub ?? defaults.hub,
      folder_cycle: given.warnings?.folder_cycle ?? defaults.folder_cycle,
      orphan: orphan !== false,
      policy_drift: given.warnings?.policy_drift ?? defaults.policy_drift,
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

  return `hub_threshold ${settings.hub_threshold}, cycle ${on(w.cycle)}, hub ${on(w.hub)}, folder_cycle ${on(w.folder_cycle)}, orphan ${on(w.orphan)}, policy_drift ${on(w.policy_drift)}${entries}`;
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

    const extra = [
      ...(settings.warnings.folder_cycle
        ? folderCycleFindings(scan, policy)
        : []),
      ...(settings.warnings.orphan
        ? orphanFindings(scan, policy, settings.entry_points)
        : []),
    ];

    for (const finding of extra) {
      add(warnings, finding);
    }
  }

  if (settings.warnings.policy_drift) {
    for (const finding of policyDriftFindings(scans, policy)) {
      add(warnings, finding);
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
        entry_points: [...settings.entry_points],
        warnings: {
          cycle: settings.warnings.cycle,
          hub: settings.warnings.hub,
          folder_cycle: settings.warnings.folder_cycle,
          orphan: settings.warnings.orphan,
          policy_drift: settings.warnings.policy_drift,
        },
      },
      findings: [...findings, ...warnings],
    },
    metrics,
    unranked,
  };
}
