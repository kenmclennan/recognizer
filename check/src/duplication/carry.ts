import type { FindingsDocument } from "../findings-document.js";
import type { StructureSettings } from "../structure-sensor.js";
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

export function carryDuplication(
  stored: FindingsDocument | null,
  fresh: FindingsDocument,
  settings: StructureSettings,
): FindingsDocument {
  if (
    settings.duplication === false ||
    stored === null ||
    stored.commit !== fresh.commit ||
    !sameSettings(stored.settings.duplication, settings.duplication) ||
    !sameInputs(stored.inputs, fresh.inputs)
  ) {
    return fresh;
  }

  return {
    ...fresh,
    settings: { ...fresh.settings, duplication: { ...settings.duplication } },
    findings: [
      ...fresh.findings,
      ...stored.findings.filter((finding) => finding.kind === "duplication"),
    ],
  };
}

export function isDuplicationMeasured(document: FindingsDocument): boolean {
  return document.settings.duplication !== undefined;
}

export function duplicationUnmeasured(
  document: FindingsDocument,
  settings: StructureSettings,
): boolean {
  return settings.duplication !== false && !isDuplicationMeasured(document);
}
