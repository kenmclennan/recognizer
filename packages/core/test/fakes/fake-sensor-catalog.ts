import {
  commandKey,
  type InstalledRead,
  type InstalledSensorEntry,
  type RegisteredRead,
  type RegisteredSensorInput,
  type SensorCatalog,
  sensorProgram,
} from "../../src/index.js";
import type { FakeSensors } from "./fake-sensors.js";

export class FakeSensorCatalog implements SensorCatalog {
  readonly reads: (readonly string[] | undefined)[] = [];
  failReads = false;
  readonly unreadable: string[] = [];
  readonly registeredReads: string[][] = [];

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

  readRegistered(sensors: readonly RegisteredSensorInput[]): RegisteredRead {
    const result: RegisteredRead = { entries: {}, unreadable: [] };
    const seen = new Set<string>();

    for (const one of sensors) {
      if (one.manifest === undefined) {
        continue;
      }

      const key = commandKey(one.manifest);

      if (!seen.has(key)) {
        seen.add(key);
        this.registeredReads.push(one.manifest);
      }

      const invented = [...this.sensors.installed.values()].find(
        (sensor) =>
          commandKey(
            sensor.manifestCommand ?? [sensorProgram(sensor.name), "manifest"],
          ) === key,
      );

      if (invented === undefined) {
        result.unreadable.push({
          name: one.name,
          reason: `${one.manifest.join(" ")} could not be started`,
        });
      } else if (invented.unreadable !== undefined) {
        result.unreadable.push({ name: one.name, reason: invented.unreadable });
      } else if (result.entries[commandKey(one.command)] === undefined) {
        result.entries[commandKey(one.command)] = {
          name: invented.name,
          display: invented.display ?? invented.name,
          runs_tests: invented.runsTests,
          scoped: invented.scoped ?? false,
          listed: invented.listed ?? true,
          placeholders: {},
          metrics: [],
          findings: [],
          settings: [],
        } satisfies InstalledSensorEntry;
      }
    }

    return result;
  }
}
