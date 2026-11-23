import {
  type PluginLimits,
  readShippedSensors,
  type SensorCatalog,
  type ShippedRead,
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import { shippedPorts } from "../../manifest-ports.js";
import type { createPluginLimits } from "../../plugin-run.js";
import { shippedSensorNames } from "./shipped-plugins-adapter.js";

type Limits = ReturnType<typeof createPluginLimits>;

export class SensorCatalogAdapter implements SensorCatalog {
  constructor(private readonly io: Io) {}

  shippedNames(): string[] {
    return shippedSensorNames();
  }

  readShipped(names?: readonly string[], limits?: PluginLimits): ShippedRead {
    return readShippedSensors(
      shippedPorts(this.io),
      limits === undefined ? undefined : (limits as unknown as Limits).readOf,
      names,
    );
  }
}
