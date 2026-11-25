import { InvalidRequest } from "../../domain/invalid-request.js";
import {
  type InstalledRead,
  sensorCommand,
  sensorProgram,
  withSuiteSettings,
} from "./installed-sensors.js";

interface Sensor {
  name: string;
  command: string[];
  manifest?: string[];
}

export function selectSensors(
  registered: Sensor[],
  requested: "all" | string[],
  installed: readonly string[] = [],
  suites?: readonly unknown[],
  read: InstalledRead = { sensors: [], unreadable: [] },
): Sensor[] {
  const given = (one: Sensor) => ({
    ...one,
    command: withSuiteSettings(one.command, read, suites),
  });

  if (requested === "all") {
    if (registered.length === 0) {
      throw new InvalidRequest([
        "no sensors are registered: name one, or add it to .recognizer/config.yaml",
      ]);
    }

    return registered.map(given);
  }

  if (requested.includes("duplication")) {
    throw new InvalidRequest([
      "duplication is part of structural analysis and runs with every scan",
    ]);
  }

  const names = registered.map((one) => one.name);
  const unknown = requested.filter(
    (name) => !names.includes(name) && !installed.includes(name),
  );

  if (unknown.length > 0) {
    throw new InvalidRequest([
      ...unknown.map((name) => `no such sensor: ${name}`),
      `registered sensors: ${names.join(", ")}`,
      `installed sensors: ${installed.join(", ")}`.trimEnd(),
    ]);
  }

  return [
    ...registered.filter((one) => requested.includes(one.name)).map(given),
    ...requested
      .filter((name, index) => requested.indexOf(name) === index)
      .filter((name) => !names.includes(name))
      .map((name) => ({
        name,
        command: withSuiteSettings(sensorCommand(name, {}), read, suites),
        manifest: [sensorProgram(name), "manifest"],
      })),
  ];
}
