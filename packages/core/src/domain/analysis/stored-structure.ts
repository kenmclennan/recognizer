import type { SensorFindings } from "../sensor-findings.js";
import {
  STRUCTURE_SENSOR_VERSION,
  type StructureSettings,
} from "../structure-settings.js";
import type { UnknownFiles } from "../unknown-files.js";

export interface StoredStructureContext {
  commit: string;
  settings: StructureSettings;
  unknownFiles: UnknownFiles | null;
}

function withoutMeasured(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const {
    duplication: _duplication,
    complexity_limit: _complexityLimit,
    ...rest
  } = settings;

  return rest;
}

function complexityAgrees(
  document: SensorFindings,
  settings: StructureSettings,
): boolean {
  const recorded = document.settings.complexity_limit;

  if (!settings.warnings.complexity) {
    return recorded === undefined;
  }

  return recorded === undefined || recorded === settings.complexity_limit;
}

function duplicationAgrees(
  document: SensorFindings,
  settings: StructureSettings,
): boolean {
  const recorded = document.settings.duplication;

  if (settings.duplication === false) {
    return recorded === undefined;
  }

  return (
    recorded === undefined ||
    JSON.stringify(recorded) === JSON.stringify(settings.duplication)
  );
}

export function storedStructureReusable(
  document: SensorFindings,
  context: StoredStructureContext,
): boolean {
  const { settings } = context;

  return (
    document.commit === context.commit &&
    !document.modified &&
    JSON.stringify(document.unknownFiles ?? null) ===
      JSON.stringify(context.unknownFiles) &&
    document.sensor.version === STRUCTURE_SENSOR_VERSION &&
    duplicationAgrees(document, settings) &&
    complexityAgrees(document, settings) &&
    JSON.stringify(withoutMeasured(document.settings)) ===
      JSON.stringify(withoutMeasured({ ...settings }))
  );
}
