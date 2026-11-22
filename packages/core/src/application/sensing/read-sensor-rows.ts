import type { SensorRow } from "../../domain/scan-plan.js";
import type { Sensors } from "./ports/sensors.js";

export function readSensorRows(
  ports: { sensors: Pick<Sensors, "registered"> },
  root: string,
): SensorRow[] {
  return ports.sensors.registered(root);
}
