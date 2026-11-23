import type {
  ManifestRead,
  SensorCheckReport,
  SensorChecks,
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import { checkSensor } from "../../sensors-check.js";

export class SensorChecksAdapter implements SensorChecks {
  constructor(private readonly io: Io) {}

  check(
    root: string,
    sensor: { name: string; command: string[] },
    options: Record<string, never>,
    read: () => ManifestRead,
  ): SensorCheckReport {
    return checkSensor(this.io, root, sensor, options, read);
  }
}
