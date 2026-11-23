import {
  BASELINE_KINDS,
  type BaselineEntry,
  type BaselineRepository,
  compareEntries,
  entryId,
  type IdEntry,
  type Identity,
  isIdEntry,
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import { InputError } from "../../errors.js";

function hasExactKeys(value: object, keys: string[]): boolean {
  const actual = Object.keys(value).sort();

  return (
    actual.length === keys.length && actual.every((key, i) => key === keys[i])
  );
}

export function parseBaseline(jsonText: string): BaselineEntry[] {
  let document: unknown;

  try {
    document = JSON.parse(jsonText);
  } catch (error) {
    throw new InputError([
      `baseline is not valid JSON: ${(error as Error).message}`,
    ]);
  }

  if (
    typeof document !== "object" ||
    document === null ||
    Array.isArray(document)
  ) {
    throw new InputError(["baseline must be a JSON object"]);
  }

  const record = document as Record<string, unknown>;

  if (!hasExactKeys(record, ["schema_version", "violations"])) {
    throw new InputError([
      "baseline must hold exactly schema_version and violations",
    ]);
  }

  if (record.schema_version !== 1) {
    throw new InputError([
      `baseline schema_version ${String(record.schema_version)} is not supported`,
    ]);
  }

  if (!Array.isArray(record.violations)) {
    throw new InputError(["baseline violations must be a list"]);
  }

  const errors: string[] = [];
  const entries: BaselineEntry[] = [];

  record.violations.forEach((entry: unknown, index) => {
    if (typeof entry !== "object" || entry === null) {
      errors.push(
        `baseline violations[${index}] must be {from, to, kind} or {id}`,
      );

      return;
    }

    const asIdentity = entry as Identity;
    const asId = entry as IdEntry;

    if (
      hasExactKeys(entry, ["from", "kind", "to"]) &&
      typeof asIdentity.from === "string" &&
      typeof asIdentity.to === "string" &&
      BASELINE_KINDS.has(asIdentity.kind)
    ) {
      entries.push({
        from: asIdentity.from,
        to: asIdentity.to,
        kind: asIdentity.kind,
      });
    } else if (
      hasExactKeys(entry, ["id"]) &&
      typeof asId.id === "string" &&
      asId.id !== ""
    ) {
      entries.push({ id: asId.id });
    } else {
      errors.push(
        `baseline violations[${index}] must be {from, to, kind} or {id}`,
      );
    }
  });

  if (errors.length > 0) {
    throw new InputError(errors);
  }

  for (let i = 1; i < entries.length; i += 1) {
    const order = compareEntries(
      entries[i - 1] as BaselineEntry,
      entries[i] as BaselineEntry,
    );

    if (order === 0) {
      throw new InputError([
        `baseline has a duplicate entry at violations[${i}]`,
      ]);
    }

    if (order > 0) {
      throw new InputError([`baseline is not sorted at violations[${i}]`]);
    }
  }

  const ids = new Set<string>();

  entries.forEach((entry, index) => {
    const id = entryId(entry);

    if (ids.has(id)) {
      throw new InputError([
        `baseline has a duplicate entry at violations[${index}]`,
      ]);
    }

    ids.add(id);
  });

  return entries;
}

export function serialiseBaseline(entries: BaselineEntry[]): string {
  const sorted = entries
    .map((entry) =>
      isIdEntry(entry)
        ? { id: entry.id }
        : { from: entry.from, to: entry.to, kind: entry.kind },
    )
    .sort(compareEntries);

  return `${JSON.stringify({ schema_version: 1, violations: sorted }, null, 2)}\n`;
}

export class BaselineAdapter implements BaselineRepository {
  constructor(private readonly io: Io) {}

  exists(path: string): boolean {
    return this.io.exists(path);
  }

  read(path: string): BaselineEntry[] {
    let text: string;

    try {
      text = this.io.readFile(path);
    } catch {
      throw new InputError([`cannot read baseline file: ${path}`]);
    }

    return parseBaseline(text);
  }

  write(path: string, entries: BaselineEntry[]): void {
    this.io.writeFile(path, serialiseBaseline(entries));
  }
}
