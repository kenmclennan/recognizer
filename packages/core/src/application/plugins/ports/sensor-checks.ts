import type { ManifestRead } from "../../../domain/plugins/manifest.js";

export interface SensorCheckReport {
  gaps: { line: string }[];
}

export interface SensorChecks {
  check(
    root: string,
    sensor: { name: string; command: string[] },
    options: Record<string, never>,
    read: () => ManifestRead,
  ): SensorCheckReport;
}
