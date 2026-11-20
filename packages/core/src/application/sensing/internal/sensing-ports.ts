import type { Clock } from "../../shared/ports/clock.js";
import type { Store } from "../../shared/ports/store.js";
import type { Sensors } from "../ports/sensors.js";

export interface SensingPorts {
  sensors: Sensors;
  store: Store;
  clock: Clock;
}
