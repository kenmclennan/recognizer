import type { Io } from "./cli.js";
import { readConfig } from "./config.js";
import { describerVersion } from "./describer-version.js";

export { describerVersion };

export interface DescriberInEffect {
  command: string[];
  version: string;
}

export function findDescriber(io: Io, root: string): DescriberInEffect | null {
  const configured = readConfig(io, root, ["describer"])?.describer;

  if (configured === undefined) {
    return null;
  }

  return { ...configured, version: describerVersion(configured) };
}
