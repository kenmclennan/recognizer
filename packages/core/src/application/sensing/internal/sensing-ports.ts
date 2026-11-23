import type { ConfigRepository } from "../../../domain/config-repository.js";
import type { Clock } from "../../shared/ports/clock.js";
import type { SelectionFiles } from "../ports/selection-files.js";
import type { SensorCatalog } from "../ports/sensor-catalog.js";
import type { Sensors } from "../ports/sensors.js";

export interface SensingPorts {
  sensors: Sensors;
  config: ConfigRepository;
  clock: Clock;
  catalog: SensorCatalog;
  files: SelectionFiles;
}
