import { join } from "node:path";
import type { Io } from "./cli.js";
import { type Config, parseConfig } from "./config-parse.js";

export type {
  Config,
  MetricDeclaration,
  OverlayRegistration,
  SensorEntry,
  SensorRegistration,
  StructureSettingsInput,
} from "./config-parse.js";

export function configFile(root: string): string {
  return join(root, ".recognizer", "config.yaml");
}

export function readConfig(io: Io, root: string): Config | null {
  const file = configFile(root);

  if (!io.exists(file)) {
    return null;
  }

  return parseConfig(io.readFile(file));
}
