import type { Gap } from "../../domain/gap.js";
import type { SensingPorts } from "./internal/sensing-ports.js";
import type { ProgramGapsInput } from "./ports/sensors.js";

export type { ProgramGapsInput };

export function findProgramGaps(
  ports: SensingPorts,
  input: ProgramGapsInput,
): Gap[] {
  return ports.sensors.programGaps(input);
}
