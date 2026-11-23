import { type Gap, outside } from "../../domain/gap.js";
import type { PluginLimits } from "../shared/ports/process.js";
import type { SensingPorts } from "./internal/sensing-ports.js";

export interface ReadinessInput {
  root: string;
  commit: string | null;
  sensors: { name: string; command: string[] }[];
  limits: PluginLimits;
}

export function findReadinessGaps(
  ports: SensingPorts,
  { root, commit, sensors, limits }: ReadinessInput,
): Gap[] {
  if (commit === null) {
    return [];
  }

  return ports.sensors
    .readinessReports(root, sensors, limits)
    .flatMap((report) =>
      report.gaps.map((gap) => ({
        id: `${report.name}:${gap.suite ?? "config"}:${gap.code}`,
        line: gap.line,
        needs: [report.name],
        fix: outside(`recognizer help sensors ${report.name}`),
      })),
    );
}
