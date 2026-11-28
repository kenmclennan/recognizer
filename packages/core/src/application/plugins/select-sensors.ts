import { InvalidRequest } from "../../domain/invalid-request.js";
import { type InstalledRead, withSuiteSettings } from "./installed-sensors.js";

interface Sensor {
  name: string;
  command: string[];
  manifest?: string[];
}

export const NO_SENSORS_REGISTERED =
  "no sensors are registered: register one with recognizer plugin register <program|path>";

export function selectSensors(
  registered: Sensor[],
  requested: "all" | string[],
  suites?: readonly unknown[],
  read: InstalledRead = { sensors: [], unreadable: [] },
): Sensor[] {
  const given = (one: Sensor) => ({
    ...one,
    command: withSuiteSettings(one.command, read, suites),
  });

  if (requested !== "all" && requested.includes("duplication")) {
    throw new InvalidRequest([
      "duplication is part of structural analysis and runs with every scan",
    ]);
  }

  if (registered.length === 0) {
    throw new InvalidRequest([NO_SENSORS_REGISTERED]);
  }

  if (requested === "all") {
    return registered.map(given);
  }

  const names = registered.map((one) => one.name);
  const unknown = requested.filter((name) => !names.includes(name));

  if (unknown.length > 0) {
    throw new InvalidRequest([
      ...unknown.map((name) => `no such sensor: ${name}`),
      `registered sensors: ${names.join(", ")}`,
    ]);
  }

  return registered.filter((one) => requested.includes(one.name)).map(given);
}
