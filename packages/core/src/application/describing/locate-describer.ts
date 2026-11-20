import type { DescribingPorts } from "./internal/describing-ports.js";
import type { LocatedDescriber } from "./ports/describer.js";

export type { LocatedDescriber };

export function locateDescriber(
  ports: DescribingPorts,
  root: string,
): LocatedDescriber {
  return ports.describer.locate(root);
}
