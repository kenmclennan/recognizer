import type { ShippedRead } from "../../plugins/shipped-plugins.js";
import type { PluginLimits } from "../../shared/ports/process.js";

export interface SensorCatalog {
  shippedNames(): string[];
  readShipped(names?: readonly string[], limits?: PluginLimits): ShippedRead;
}
