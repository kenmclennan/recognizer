import type { LocatedDescriber } from "../describing/locate-describer.js";
import { commandKey } from "../plugins/installed-sensors.js";
import type { SensorSelection } from "./ports/sensors.js";

export function installLines(
  selection: SensorSelection,
  located: LocatedDescriber,
): Record<string, string> {
  const lines: Record<string, string> = {};

  for (const one of selection.selected) {
    const line =
      selection.installed.registered?.[commandKey(one.command)]?.install;

    if (line === undefined) {
      continue;
    }

    for (const program of [one.manifest?.[0], one.command[0]]) {
      if (program !== undefined) {
        lines[program] = line;
      }
    }
  }

  const describer = located.describer;

  if (describer !== null && located.install !== undefined) {
    lines[describer.command[0] as string] = located.install;
  }

  return lines;
}
