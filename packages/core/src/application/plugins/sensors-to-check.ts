import type { CheckableSensor } from "../../domain/plugins/sensor-check.js";
import {
  readRegisteredSensors,
  sensorCommand,
  sensorsInEffect,
  withRegistered,
} from "./installed-sensors.js";
import type { PluginPorts } from "./internal/plugin-ports.js";
import { readManifestCommand } from "./read-manifest.js";
import { selectSensors } from "./select-sensors.js";

export function sensorsToCheck(
  ports: Pick<
    PluginPorts,
    "programs" | "validators" | "repository" | "registrations"
  >,
  root: string,
  name: string | undefined,
  withSuites = true,
): CheckableSensor[] {
  const registered = sensorsInEffect(ports).map((one) => ({
    name: one.name,
    command: sensorCommand(
      one.command,
      ports.repository.sensorSettings(root, one.name),
    ),
    manifest: one.manifest,
  }));
  const requested = name === undefined ? "all" : [name];

  if (!withSuites) {
    return selectSensors(registered, requested);
  }

  const chosen = selectSensors(registered, requested);
  const read = withRegistered(
    { sensors: [], unreadable: [] },
    readRegisteredSensors(chosen, (words) => readManifestCommand(ports, words)),
  );

  return selectSensors(
    registered,
    requested,
    ports.repository.suites(root),
    read,
  );
}
