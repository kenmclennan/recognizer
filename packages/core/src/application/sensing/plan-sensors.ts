import type { SensingPorts } from "./internal/sensing-ports.js";
import type {
  PlannedSensor,
  SensorPlan,
  SensorPlanInput,
} from "./ports/sensors.js";

export type { PlannedSensor, SensorPlan, SensorPlanInput };

export function planSensors(
  ports: SensingPorts,
  input: SensorPlanInput,
): SensorPlan {
  return ports.sensors.plan(input);
}
