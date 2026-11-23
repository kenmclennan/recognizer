import type {
  SensorCatalog,
  ShippedRead,
  ShippedSensorEntry,
} from "../../src/index.js";
import type { FakeSensors } from "./fake-sensors.js";

export class FakeSensorCatalog implements SensorCatalog {
  readonly reads: (readonly string[] | undefined)[] = [];

  constructor(private readonly sensors: FakeSensors) {}

  shippedNames(): string[] {
    return [...this.sensors.installed.keys()];
  }

  readShipped(names?: readonly string[]): ShippedRead {
    this.reads.push(names);

    const entries: ShippedSensorEntry[] = [...this.sensors.installed.values()]
      .filter((sensor) => names === undefined || names.includes(sensor.name))
      .map((sensor) => ({
        name: sensor.name,
        display: sensor.display ?? sensor.name,
        runs_tests: sensor.runsTests,
        scoped: sensor.scoped ?? false,
        listed: sensor.listed ?? true,
        metrics: [],
        findings: [],
        settings: [],
      }));

    return { sensors: entries, unreadable: [] };
  }
}
