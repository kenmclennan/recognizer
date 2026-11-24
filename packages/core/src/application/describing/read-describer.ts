import { InvalidRequest } from "../../domain/invalid-request.js";
import { noneRegistered } from "../plugins/installed-sensors.js";
import type { DescribingPorts } from "./internal/describing-ports.js";

export interface DescriberInEffect {
  command: readonly string[];
  version: string;
}

export function readDescriber(
  ports: DescribingPorts,
  root: string,
): DescriberInEffect {
  const located = ports.describer.locate(root);

  if (located.describer === null) {
    throw new InvalidRequest([noneRegistered()]);
  }

  return {
    command: located.describer.command,
    version: located.describer.version,
  };
}
