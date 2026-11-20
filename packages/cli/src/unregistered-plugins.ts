import { InputError } from "./errors.js";
import { SHIPPED_SENSORS } from "./shipped-sensors.js";

export function unregisteredMessage(name: string): string {
  return `${name} is not registered in .recognizer/config.yaml; register it with \`${UNREGISTERED_FIX(name)}\`.`;
}

export function refuseUnregistered(
  registered: readonly string[],
  requested: readonly string[],
): void {
  const names = unregisteredSensors(registered, requested);

  if (names.length > 0) {
    throw new InputError(names.map(unregisteredMessage));
  }
}

export function UNREGISTERED_FIX(name: string): string {
  return `recognizer plugin add ${name}`;
}

export function unregisteredSensors(
  registered: readonly string[],
  requested: readonly string[],
): string[] {
  const names: string[] = [];

  for (const name of requested) {
    if (
      SHIPPED_SENSORS.includes(name) &&
      !registered.includes(name) &&
      !names.includes(name)
    ) {
      names.push(name);
    }
  }

  return names;
}
