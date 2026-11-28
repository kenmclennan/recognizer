import {
  commandKey,
  type InstalledRead,
  sensorCommand,
  withRegistered,
} from "../plugins/installed-sensors.js";
import { selectSensors as selectFrom } from "../plugins/select-sensors.js";
import type { SensingPorts } from "./internal/sensing-ports.js";
import type { SensorSelection, SensorSelectionInput } from "./ports/sensors.js";

export type { SensorSelection, SensorSelectionInput };

export function selectSensors(
  ports: SensingPorts,
  input: SensorSelectionInput,
): SensorSelection {
  const { sense, config, limits } = input;
  const registered = ports.catalog.sensorsInEffect().map((one) => ({
    name: one.name,
    command: sensorCommand(
      one.command,
      ports.config.sensorSettings(config, one.name),
    ),
    manifest: one.manifest,
  }));
  const requested: "all" | string[] =
    sense === "all" || sense === null ? "all" : sense.map((one) => one.name);
  let installed: InstalledRead = { sensors: [], unreadable: [] };
  let selected: { name: string; command: string[]; manifest?: string[] }[] = [];

  if (sense !== null) {
    const first = selectFrom(registered, requested, undefined, installed);
    const read = ports.catalog.readRegistered(
      [
        ...first,
        ...registered.filter(
          (one) => !first.some((chosen) => chosen.name === one.name),
        ),
      ],
      limits,
    );

    selected = selectFrom(
      registered,
      requested,
      ports.config.tests(config),
      withRegistered(installed, read),
    );
    installed = withRegistered(installed, {
      entries: Object.fromEntries(
        selected.flatMap((one, at) => {
          const entry = read.entries[commandKey((first[at] ?? one).command)];

          return entry === undefined ? [] : [[commandKey(one.command), entry]];
        }),
      ),
      unreadable: read.unreadable,
    });
  }

  return { selected, installed };
}
