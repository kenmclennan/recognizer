import type { ConfigRepository } from "../../../domain/config-repository.js";
import type { Clock } from "../../shared/ports/clock.js";
import type { Sensors } from "../ports/sensors.js";

export interface SensingPorts {
  sensors: Sensors;
  config: ConfigRepository;
  clock: Clock;
}
