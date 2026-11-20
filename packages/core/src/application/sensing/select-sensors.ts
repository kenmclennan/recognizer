import type { SensingPorts } from "./internal/sensing-ports.js";
import type { SensorSelection, SensorSelectionInput } from "./ports/sensors.js";

export type { SensorSelection, SensorSelectionInput };

export function selectSensors(
  ports: SensingPorts,
  input: SensorSelectionInput,
): SensorSelection {
  return ports.sensors.select(input);
}
