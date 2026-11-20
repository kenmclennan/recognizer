import type { Gap } from "../../domain/gap.js";
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
  return commit === null
    ? []
    : ports.sensors.readinessGaps(root, sensors, limits);
}
