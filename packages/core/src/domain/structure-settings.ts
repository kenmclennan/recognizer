import {
  DEFAULT_DUPLICATION_SETTINGS,
  type DuplicationSettings,
} from "./duplication-settings.js";
import { COMPLEXITY_LIMIT, LONG_FUNCTION } from "./function-length.js";

export const STRUCTURE_SENSOR_VERSION = "23";

export interface StructureSettings {
  duplication: false | DuplicationSettings;
  entry_points: string[];
  entry_annotations: string[];
  warnings: {
    cycle: boolean;
    orphan: boolean;
    unused_exports: boolean;
    private_imports: boolean;
    long_function: boolean;
    complexity: boolean;
  };
  long_function_limit: number;
  complexity_limit: number;
}

export const DEFAULT_STRUCTURE_SETTINGS: StructureSettings = {
  duplication: { ...DEFAULT_DUPLICATION_SETTINGS },
  entry_points: [],
  entry_annotations: [],
  warnings: {
    cycle: true,
    orphan: true,
    unused_exports: false,
    private_imports: true,
    long_function: true,
    complexity: true,
  },
  long_function_limit: LONG_FUNCTION,
  complexity_limit: COMPLEXITY_LIMIT,
};

export function describeSettings(settings: StructureSettings): string {
  const on = (value: boolean) => (value ? "on" : "off");

  const w = settings.warnings;
  const entries =
    settings.entry_points.length > 0
      ? `, entry_points ${settings.entry_points.length}`
      : "";
  const annotations =
    settings.entry_annotations.length > 0
      ? `, entry_annotations ${settings.entry_annotations.length}`
      : "";

  return `cycle ${on(w.cycle)}, orphan ${on(w.orphan)}, unused_exports ${on(w.unused_exports)}, private_imports ${on(w.private_imports)}, long_function ${on(w.long_function)}, long_function_limit ${settings.long_function_limit}, complexity ${on(w.complexity)}, complexity_limit ${settings.complexity_limit}${entries}${annotations}`;
}
