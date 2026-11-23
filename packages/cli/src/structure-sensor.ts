import {
  DEFAULT_DUPLICATION_SETTINGS,
  DEFAULT_STRUCTURE_SETTINGS,
  type StructureSettings,
} from "@recognizer/core";
import type { Config } from "./config-parse.js";

export function resolveStructureSettings(
  config: Config | null,
): StructureSettings | "off" {
  const entry = config?.sensors?.structure;

  if (entry === "off") {
    return "off";
  }

  const given = entry !== undefined && "command" in entry ? {} : (entry ?? {});

  const defaults = DEFAULT_STRUCTURE_SETTINGS.warnings;
  const orphan = given.warnings?.orphan ?? true;
  const longFunction = given.warnings?.long_function ?? true;
  const complexity = given.warnings?.complexity ?? true;

  const duplication = given.duplication;

  return {
    duplication:
      duplication === false
        ? false
        : { ...DEFAULT_DUPLICATION_SETTINGS, ...(duplication ?? {}) },
    entry_points:
      typeof orphan === "object" ? [...(orphan.entry_points ?? [])] : [],
    entry_annotations:
      typeof orphan === "object" ? [...(orphan.entry_annotations ?? [])] : [],
    warnings: {
      cycle: given.warnings?.cycle ?? defaults.cycle,
      orphan: orphan !== false,
      unused_exports: given.warnings?.unused_exports ?? defaults.unused_exports,
      private_imports:
        given.warnings?.private_imports ?? defaults.private_imports,
      long_function: longFunction !== false,
      complexity: complexity !== false,
    },
    long_function_limit:
      typeof longFunction === "object"
        ? longFunction.limit
        : DEFAULT_STRUCTURE_SETTINGS.long_function_limit,
    complexity_limit:
      typeof complexity === "object"
        ? complexity.limit
        : DEFAULT_STRUCTURE_SETTINGS.complexity_limit,
  };
}
