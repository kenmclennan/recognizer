import type { SensorFindings } from "../../sensor-findings.js";
import type { StructureSettings } from "../../structure-settings.js";
import type { DuplicationSettings } from "./findings.js";

function sameSettings(stored: unknown, settings: DuplicationSettings): boolean {
  if (typeof stored !== "object" || stored === null) {
    return false;
  }

  const found = stored as Record<string, unknown>;

  return (
    found.threshold === settings.threshold &&
    found.min_lines === settings.min_lines &&
    found.pair_min_lines === settings.pair_min_lines &&
    found.min_nodes === settings.min_nodes
  );
}

function sameInputs(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  const entries = (inputs: Record<string, string> | undefined) =>
    JSON.stringify(
      Object.entries(inputs ?? {}).sort(([x], [y]) =>
        x < y ? -1 : x > y ? 1 : 0,
      ),
    );

  return entries(a) === entries(b);
}

function sameComplexity(
  stored: SensorFindings,
  settings: StructureSettings,
): boolean {
  return (
    settings.warnings.complexity &&
    stored.settings.complexity_limit === settings.complexity_limit
  );
}

export function carryMeasured(
  stored: SensorFindings | null,
  fresh: SensorFindings,
  settings: StructureSettings,
): SensorFindings {
  if (
    stored === null ||
    stored.sensor.version !== fresh.sensor.version ||
    stored.commit !== fresh.commit ||
    !sameInputs(stored.inputs, fresh.inputs)
  ) {
    return fresh;
  }

  const carryDuplication =
    settings.duplication !== false &&
    sameSettings(stored.settings.duplication, settings.duplication);
  const carryComplexity = sameComplexity(stored, settings);

  if (!carryDuplication && !carryComplexity) {
    return fresh;
  }

  return {
    ...fresh,
    settings: {
      ...fresh.settings,
      ...(carryDuplication && settings.duplication !== false
        ? { duplication: { ...settings.duplication } }
        : {}),
      ...(carryComplexity
        ? { complexity_limit: settings.complexity_limit }
        : {}),
    },
    findings: [
      ...fresh.findings,
      ...stored.findings.filter(
        (finding) =>
          (carryDuplication && finding.kind === "duplication") ||
          (carryComplexity && finding.kind === "complexity"),
      ),
    ],
  };
}

export function isDuplicationMeasured(document: SensorFindings): boolean {
  return document.settings.duplication !== undefined;
}

export function duplicationUnmeasured(
  document: SensorFindings,
  settings: StructureSettings,
): boolean {
  return settings.duplication !== false && !isDuplicationMeasured(document);
}

export function complexityUnmeasured(
  document: SensorFindings,
  settings: StructureSettings,
): boolean {
  return (
    settings.warnings.complexity &&
    document.settings.complexity_limit === undefined
  );
}
