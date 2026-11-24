import { InvalidRequest } from "../../domain/invalid-request.js";
import { noneRegistered } from "../plugins/installed-sensors.js";
import type { DescribingPorts } from "./internal/describing-ports.js";
import type { LocatedDescriber } from "./ports/describer.js";

export type { LocatedDescriber };

export function locateDescriber(
  ports: DescribingPorts,
  root: string,
): LocatedDescriber {
  const located = ports.describer.locate(root);

  if (located.describer === null) {
    throw new InvalidRequest([noneRegistered()]);
  }

  return located;
}
