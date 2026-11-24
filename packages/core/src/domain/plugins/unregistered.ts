export function UNREGISTERED_FIX(name: string): string {
  return `recognizer plugin add ${name}`;
}

export function unregisteredMessage(name: string): string {
  return `${name} is not registered in .recognizer/config.yaml; register it with \`${UNREGISTERED_FIX(name)}\`.`;
}

export function unregisteredSensors(
  registered: readonly string[],
  requested: readonly string[],
  installed: readonly string[],
): string[] {
  const names: string[] = [];

  for (const name of requested) {
    if (
      installed.includes(name) &&
      !registered.includes(name) &&
      !names.includes(name)
    ) {
      names.push(name);
    }
  }

  return names;
}
