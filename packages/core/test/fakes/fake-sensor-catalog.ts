import type {
  InstalledRead,
  InstalledSensorEntry,
  SensorCatalog,
} from "../../src/index.js";
import type { FakeSensors } from "./fake-sensors.js";

export class FakeSensorCatalog implements SensorCatalog {
  readonly reads: (readonly string[] | undefined)[] = [];
  failReads = false;
  readonly unreadable: string[] = [];

  constructor(private readonly sensors: FakeSensors) {}

  installedNames(): string[] {
    if (this.failReads) {
      throw new Error("the plugin listing failed");
    }

    return [...this.sensors.installed.keys()].sort();
  }

  unreadableFolders(): string[] {
    return [...this.unreadable];
  }

  readInstalled(names?: readonly string[]): InstalledRead {
    if (this.failReads) {
      throw new Error("the plugin listing failed");
    }

    this.reads.push(names);

    const chosen = [...this.sensors.installed.values()]
      .filter((sensor) => names === undefined || names.includes(sensor.name))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const entries: InstalledSensorEntry[] = chosen
      .filter((sensor) => sensor.unreadable === undefined)
      .map((sensor) => ({
        name: sensor.name,
        display: sensor.display ?? sensor.name,
        runs_tests: sensor.runsTests,
        scoped: sensor.scoped ?? false,
        listed: sensor.listed ?? true,
        placeholders: {},
        metrics: [],
        findings: [],
        settings: [],
      }));
    const unreadable = chosen.flatMap((sensor) =>
      sensor.unreadable === undefined
        ? []
        : [{ name: sensor.name, reason: sensor.unreadable }],
    );

    return { sensors: entries, unreadable };
  }
}
