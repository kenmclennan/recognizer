import { InvalidRequest } from "../../domain/invalid-request.js";
import {
  type ShippedRead,
  shippedCommand,
  withSuiteSettings,
} from "./shipped-plugins.js";

export function selectSensors(
  registered: { name: string; command: string[] }[],
  requested: "all" | string[],
  shipped: readonly string[] = [],
  suites?: readonly unknown[],
  read: ShippedRead = { sensors: [], unreadable: [] },
): { name: string; command: string[] }[] {
  const given = (one: { name: string; command: string[] }) => ({
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
    (name) => !names.includes(name) && !shipped.includes(name),
  );

  if (unknown.length > 0) {
    throw new InvalidRequest([
      ...unknown.map((name) => `no such sensor: ${name}`),
      `registered sensors: ${names.join(", ")}`,
      `shipped sensors: ${shipped.join(", ")}`,
    ]);
  }

  return [
    ...registered.filter((one) => requested.includes(one.name)).map(given),
    ...requested
      .filter((name, index) => requested.indexOf(name) === index)
      .filter((name) => !names.includes(name))
      .map((name) => ({
        name,
        command: withSuiteSettings(shippedCommand(name, {}), read, suites),
      })),
  ];
}
