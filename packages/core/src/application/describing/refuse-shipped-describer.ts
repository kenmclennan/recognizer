import type { DescribingPorts } from "./internal/describing-ports.js";
import type { LocatedDescriber } from "./ports/describer.js";

export function refuseShippedDescriber(
  ports: DescribingPorts,
  located: LocatedDescriber,
): void {
  ports.describer.refuseShipped(located);
}
