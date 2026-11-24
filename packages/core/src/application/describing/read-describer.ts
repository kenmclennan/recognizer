import { InvalidRequest } from "../../domain/invalid-request.js";
import type { DescribingPorts } from "./internal/describing-ports.js";

export function noneRegistered(shipped: string): string {
  return `no describer is registered: add one to .recognizer/config.yaml and ${shipped} is not installed`;
}

export interface DescriberInEffect {
  command: readonly string[];
  version: string;
  source: "config" | "shipped";
}

export function readDescriber(
  ports: DescribingPorts,
  root: string,
): DescriberInEffect {
  const located = ports.describer.locate(root);

  if (located.describer === null) {
    throw new InvalidRequest([
      noneRegistered(ports.describer.shippedProgram()),
    ]);
  }

  return {
    command: located.describer.command,
    version: located.describer.version,
    source: located.shipped ? "shipped" : "config",
  };
}
