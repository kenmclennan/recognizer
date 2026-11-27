import {
  type InstalledRead,
  installedSensorNames,
  type PluginLimits,
  type RegisteredRead,
  type RegisteredSensorInput,
  readInstalledSensors,
  readManifestCommand,
  readRegisteredSensors,
  type SensorCatalog,
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import { manifestPorts } from "../../manifest-ports.js";
import type { createPluginLimits } from "../../plugin-run.js";

type Limits = ReturnType<typeof createPluginLimits>;

export class SensorCatalogAdapter implements SensorCatalog {
  constructor(private readonly io: Io) {}

  installedNames(): string[] {
    return installedSensorNames(manifestPorts(this.io));
  }

  unreadableFolders(): string[] {
    return manifestPorts(this.io).programs.unreadableOnPath();
  }

  readInstalled(
    names?: readonly string[],
    limits?: PluginLimits,
  ): InstalledRead {
    return readInstalledSensors(
      manifestPorts(this.io),
      names,
      limits === undefined
        ? undefined
        : (limits as unknown as Limits).readCommandOf,
    );
  }

  readRegistered(
    sensors: readonly RegisteredSensorInput[],
    limits?: PluginLimits,
  ): RegisteredRead {
    return readRegisteredSensors(
      sensors,
      limits === undefined
        ? (words) => readManifestCommand(manifestPorts(this.io), words)
        : (limits as unknown as Limits).readCommandOf,
    );
  }
}
