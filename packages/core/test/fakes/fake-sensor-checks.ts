import type { SensorCheckReport, SensorChecks } from "../../src/index.js";

export class FakeSensorChecks implements SensorChecks {
  readonly gaps = new Map<string, string[]>();

  check(
    _root: string,
    sensor: { name: string; command: string[] },
  ): SensorCheckReport {
    return {
      gaps: (this.gaps.get(sensor.name) ?? []).map((line) => ({ line })),
    };
  }
}
