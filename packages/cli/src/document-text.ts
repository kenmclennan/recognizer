import type { SensorFindings } from "@recognizer/core";
import { readSensorFindings } from "./adapters/filesystem/findings-translator.js";
import { parseConfig } from "./config-parse.js";
import { describerVersion } from "./describer-version.js";
import { type Overlay, validateOverlay } from "./overlays.js";

export function readFindingsText(text: string, name: string): SensorFindings {
  return readSensorFindings(JSON.parse(text), { name }) as SensorFindings;
}

export function readOverlayText(text: string) {
  const parsed = JSON.parse(text) as Overlay;

  return validateOverlay(parsed, {
    commit: parsed.commit,
    modified: parsed.modified,
    metrics: parsed.metrics,
  });
}

export function describerOfConfigText(
  text: string | null,
): { command: string[]; version: string } | undefined {
  if (text === null) {
    return undefined;
  }

  try {
    const configured = parseConfig(text).describer;

    return configured === undefined
      ? undefined
      : { ...configured, version: describerVersion(configured) };
  } catch {
    return undefined;
  }
}
