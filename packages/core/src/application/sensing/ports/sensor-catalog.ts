import type {
  InstalledRead,
  RegisteredRead,
  RegisteredSensorInput,
} from "../../plugins/installed-sensors.js";
import type { PluginLimits } from "../../shared/ports/process.js";

export interface SensorCatalog {
  installedNames(): string[];
  unreadableFolders(): string[];
  readInstalled(
    names?: readonly string[],
    limits?: PluginLimits,
  ): InstalledRead;
  readRegistered(
    sensors: readonly RegisteredSensorInput[],
    limits?: PluginLimits,
  ): RegisteredRead;
}
