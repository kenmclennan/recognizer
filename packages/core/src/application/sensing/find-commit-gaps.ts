import type { Gap } from "../../domain/gap.js";
import type { SensingPorts } from "./internal/sensing-ports.js";
import type { CommitGapsInput } from "./ports/sensors.js";

export type { CommitGapsInput };

export function findCommitGaps(
  ports: SensingPorts,
  input: CommitGapsInput,
): Gap[] {
  return ports.sensors.commitGaps(input);
}
