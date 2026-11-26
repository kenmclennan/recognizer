import type { PluginKind } from "./manifest.js";

export const REGISTRATION_VERSION = 1;

const KINDS: readonly PluginKind[] = ["scanner", "sensor", "describer"];
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const NAME_LIMIT = 64;

export type RegistrationSource = "user" | "homebrew";

export interface RegisteredPlugin {
  kind: PluginKind;
  name: string;
  command: string[];
  manifest: string[];
  source: RegistrationSource;
}

export interface RegistrationFile {
  source: RegistrationSource;
  path: string;
  fileName: string;
  text: string;
  modified: number | null;
}

export interface UnreadableRegistration {
  path: string;
  reason: string;
}

export interface RegistryEntries {
  plugins: RegisteredPlugin[];
  shadowed: RegisteredPlugin[];
  unreadable: UnreadableRegistration[];
  describer: RegisteredPlugin | null;
}

export type ParsedRegistration =
  | { ok: true; entry: Omit<RegisteredPlugin, "source"> }
  | { ok: false; reason: string };

export function registrationFileName(kind: PluginKind, name: string): string {
  return `${kind}-${name}.json`;
}

function isWords(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((word) => typeof word === "string" && word !== "")
  );
}

export function serializeRegistration(
  entry: Omit<RegisteredPlugin, "source">,
): string {
  return `${JSON.stringify(
    {
      registration_version: REGISTRATION_VERSION,
      kind: entry.kind,
      name: entry.name,
      command: entry.command,
      manifest: entry.manifest,
    },
    null,
    2,
  )}\n`;
}

export function parseRegistration(
  fileName: string,
  text: string,
): ParsedRegistration {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "it is not valid JSON" };
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "it is not a JSON object" };
  }

  const record = value as Record<string, unknown>;

  if (record.registration_version !== REGISTRATION_VERSION) {
    return {
      ok: false,
      reason: `registration_version ${JSON.stringify(record.registration_version)} is not supported (expected ${REGISTRATION_VERSION})`,
    };
  }

  const { kind, name, command, manifest } = record;

  if (typeof kind !== "string" || !KINDS.includes(kind as PluginKind)) {
    return {
      ok: false,
      reason: "kind must be scanner, sensor or describer",
    };
  }

  if (
    typeof name !== "string" ||
    !NAME_PATTERN.test(name) ||
    name.length > NAME_LIMIT
  ) {
    return {
      ok: false,
      reason: `name must match ${NAME_PATTERN.source} and be at most ${NAME_LIMIT} characters`,
    };
  }

  if (!isWords(command)) {
    return {
      ok: false,
      reason: "command must be a non-empty array of non-empty strings",
    };
  }

  if (!isWords(manifest)) {
    return {
      ok: false,
      reason: "manifest must be a non-empty array of non-empty strings",
    };
  }

  const expected = registrationFileName(kind as PluginKind, name);

  if (fileName !== expected) {
    return {
      ok: false,
      reason: `the file name ${fileName} disagrees with its kind and name (expected ${expected})`,
    };
  }

  return {
    ok: true,
    entry: { kind: kind as PluginKind, name, command, manifest },
  };
}

function newerThan(
  candidate: { entry: RegisteredPlugin; modified: number | null },
  held: { entry: RegisteredPlugin; modified: number | null },
): boolean {
  const left = candidate.modified;
  const right = held.modified;

  if (left === null) {
    return false;
  }

  if (right === null) {
    return true;
  }

  if (left !== right) {
    return left > right;
  }

  return candidate.entry.source === "user" && held.entry.source !== "user";
}

export function resolveRegistrations(
  files: readonly RegistrationFile[],
): RegistryEntries {
  const unreadable: UnreadableRegistration[] = [];
  const readable: { entry: RegisteredPlugin; modified: number | null }[] = [];

  for (const file of files) {
    const parsed = parseRegistration(file.fileName, file.text);

    if (parsed.ok) {
      readable.push({
        entry: { ...parsed.entry, source: file.source },
        modified: file.modified,
      });
    } else {
      unreadable.push({ path: file.path, reason: parsed.reason });
    }
  }

  const shadowed: RegisteredPlugin[] = [];
  const winners = new Map<
    string,
    { entry: RegisteredPlugin; modified: number | null }
  >();

  for (const item of readable) {
    const key = `${item.entry.kind}/${item.entry.name}`;
    const held = winners.get(key);

    if (held === undefined) {
      winners.set(key, item);
    } else if (item.entry.source === "user" && held.entry.source !== "user") {
      shadowed.push(held.entry);
      winners.set(key, item);
    } else {
      shadowed.push(item.entry);
    }
  }

  const survivors = [...winners.values()].sort((a, b) =>
    `${a.entry.kind}/${a.entry.name}`.localeCompare(
      `${b.entry.kind}/${b.entry.name}`,
    ),
  );
  const describers = survivors.filter(
    (item) => item.entry.kind === "describer",
  );
  let chosen: (typeof describers)[number] | null = null;

  for (const item of describers) {
    if (chosen === null || newerThan(item, chosen)) {
      chosen = item;
    }
  }

  for (const item of describers) {
    if (item !== chosen) {
      shadowed.push(item.entry);
    }
  }

  return {
    plugins: survivors
      .map((item) => item.entry)
      .filter(
        (entry) =>
          entry.kind !== "describer" ||
          (chosen !== null && entry === chosen.entry),
      ),
    shadowed,
    unreadable,
    describer: chosen === null ? null : chosen.entry,
  };
}
