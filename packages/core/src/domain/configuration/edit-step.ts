import {
  findSection,
  type PublishedKey,
  type PublishedKeys,
  REGISTRATION_KEY,
} from "./published-keys.js";

export type Step =
  | { kind: "key"; name: string }
  | { kind: "entry"; identity: string; name: string };

const WARNING_SECTION = "sensors.structure.warnings.";

export function stepsFor(published: PublishedKeys, typed: string[]): Step[] {
  return typed.map((name, at): Step => {
    const found = findSection(published, typed.slice(0, at + 1));

    if ("found" in found && found.found.shape === "list-entry") {
      return {
        kind: "entry",
        identity: found.found.identity as string,
        name,
      };
    }

    return { kind: "key", name };
  });
}

export function inWarnings(steps: Step[], at: number): boolean {
  return steps
    .slice(0, at)
    .map((entry) => entry.name)
    .join(".")
    .startsWith(WARNING_SECTION);
}

export function guardRegistration(
  published: PublishedKeys,
  typed: string[],
  entry: PublishedKey,
  names: string[],
): string | null {
  if (!published.keys.some((key) => key.key === REGISTRATION_KEY)) {
    return null;
  }

  const parent = findSection(published, typed.slice(0, -1));

  if (!("found" in parent) || parent.found.shape !== "map-entry") {
    return null;
  }

  if (entry.key === REGISTRATION_KEY) {
    return names.some((name) => name !== "command")
      ? `${typed.slice(0, -1).join(".")} holds settings; a registration is either settings or a command`
      : null;
  }

  return names.includes("command")
    ? `${typed.slice(0, -1).join(".")} is registered with a command; a registration is either settings or a command`
    : null;
}
