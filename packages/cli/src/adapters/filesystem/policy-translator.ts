import type { PolicyRule } from "@recognizer/core";
import { parse } from "yaml";
import { InputError } from "../../errors.js";

export const RETIRED_KEYS = [
  "components",
  "levels",
  "uses",
  "foreign",
] as const;

const ALLOWED_KEYS = new Set(["forbid", "ignore", "entry"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function readGlobList(
  value: unknown,
  where: string,
  errors: string[],
): string[] {
  const items = Array.isArray(value) ? value : [value];
  const globs: string[] = [];

  for (const item of items) {
    if (isNonEmptyString(item)) {
      globs.push(item);
    } else {
      errors.push(`${where}: every glob must be a non-empty string`);
    }
  }

  return globs;
}

export function parsePolicy(yamlText: string): PolicyRule[] {
  let document: unknown;

  try {
    document = parse(yamlText);
  } catch (error) {
    throw new InputError([
      `policy is not valid YAML: ${(error as Error).message}`,
    ]);
  }

  if (!isPlainObject(document)) {
    throw new InputError(["policy must be a YAML mapping"]);
  }

  const errors: string[] = [];

  for (const key of Object.keys(document)) {
    if ((RETIRED_KEYS as readonly string[]).includes(key)) {
      errors.push(
        `policy: "${key}" is retired; run recognizer doctor for the migration`,
      );
    } else if (!ALLOWED_KEYS.has(key)) {
      errors.push(`policy: unknown key "${key}"`);
    }
  }

  const forbid: PolicyRule[] = [];

  if (document.forbid !== undefined) {
    if (!Array.isArray(document.forbid)) {
      errors.push("forbid: must be a list");
    } else {
      for (const entry of document.forbid) {
        const rule = parseForbid(entry, errors);

        if (rule) {
          forbid.push(rule);
        }
      }
    }
  }

  let ignore: string[] = [];

  if (document.ignore !== undefined) {
    if (!Array.isArray(document.ignore)) {
      errors.push("ignore: must be a list of globs");
    } else {
      ignore = readGlobList(document.ignore, "ignore", errors);
    }
  }

  let entryGlobs: string[] = [];

  if (document.entry !== undefined) {
    if (!Array.isArray(document.entry)) {
      errors.push("entry: must be a list of globs");
    } else {
      entryGlobs = readGlobList(document.entry, "entry", errors);
    }
  }

  if (errors.length > 0) {
    throw new InputError(errors);
  }

  return [
    ...forbid,
    ...ignore.map((glob): PolicyRule => ({ type: "ignore", glob })),
    ...entryGlobs.map((glob): PolicyRule => ({ type: "entry", glob })),
  ];
}

function parseForbid(entry: unknown, errors: string[]): PolicyRule | null {
  if (isPlainObject(entry)) {
    return parseListRule(entry, errors);
  }

  if (typeof entry !== "string") {
    errors.push("forbid: every entry must be a string or a from/to mapping");
    return null;
  }

  const at = entry.indexOf(" -> ");

  if (at < 0) {
    errors.push(`forbid: "${entry}" must look like "<from-glob> -> <to-glob>"`);
    return null;
  }

  const from = entry.slice(0, at).trim();
  const to = entry.slice(at + 4).trim();

  if (from === "" || to === "") {
    errors.push(`forbid: "${entry}" has an empty glob`);
    return null;
  }

  return { type: "forbid", pattern: entry, from: [from], to: [to] };
}

function parseListRule(
  entry: Record<string, unknown>,
  errors: string[],
): PolicyRule | null {
  const shown = JSON.stringify(entry);
  const keys = Object.keys(entry);

  if (keys.length !== 2 || !keys.includes("from") || !keys.includes("to")) {
    errors.push(`forbid: ${shown} must have exactly the keys "from" and "to"`);
    return null;
  }

  const sides: string[][] = [];

  for (const side of ["from", "to"] as const) {
    const value = entry[side];

    if (Array.isArray(value) && value.length === 0) {
      errors.push(`forbid: ${shown} has an empty "${side}" list`);
      return null;
    }

    const before = errors.length;
    const globs = readGlobList(value, `forbid ${shown} ${side}`, errors);

    if (errors.length > before) {
      return null;
    }

    sides.push(globs);
  }

  const [from, to] = sides as [string[], string[]];

  return {
    type: "forbid",
    pattern: `${from.join(", ")} -> ${to.join(", ")}`,
    from,
    to,
  };
}
