import { InvalidRequest } from "../../domain/invalid-request.js";
import {
  noneRegistered,
  type RegistryReadPorts,
} from "../plugins/installed-sensors.js";
import { readManifestCommand } from "../plugins/read-manifest.js";
import type { DescribingPorts } from "./internal/describing-ports.js";

export interface DescriberInEffect {
  command: readonly string[];
  version: string;
}

export type DescriberLookup =
  | { command: string[]; version: string; install: string }
  | { unreadable: string };

export const DESCRIBER_RUN_WORDS: readonly string[] = [
  "run",
  "--model",
  "{model}",
  "{request}",
];

export function describerInEffect(
  ports: RegistryReadPorts,
): DescriberLookup | null {
  const registered = ports.registrations.entries().describer;

  if (registered === null) {
    return null;
  }

  const manifest = readManifestCommand(ports, registered.manifest);

  if (!manifest.ok) {
    return { unreadable: manifest.reason };
  }

  if (manifest.manifest.prompt_version === undefined) {
    return {
      unreadable: `${registered.command.join(" ")} manifest has no prompt_version`,
    };
  }

  return {
    command: [...registered.command, ...DESCRIBER_RUN_WORDS],
    version: manifest.manifest.prompt_version,
    install: manifest.manifest.install,
  };
}

export function readDescriber(
  ports: DescribingPorts,
  root: string,
): DescriberInEffect {
  const located = ports.describer.locate(root);

  if (located.unreadable !== undefined) {
    throw new InvalidRequest([located.unreadable]);
  }

  if (located.describer === null) {
    throw new InvalidRequest([noneRegistered()]);
  }

  return {
    command: located.describer.command,
    version: located.describer.version,
  };
}
