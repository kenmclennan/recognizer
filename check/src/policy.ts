import { parse } from "yaml";
import { InputError } from "./errors.js";
import { compileGlob, type Matcher } from "./glob.js";

export interface ForbidRule {
  pattern: string;
  from: Matcher;
  to: Matcher;
}

export interface Policy {
  levels: string[];
  modules: Map<string, Matcher[]>;
  forbid: ForbidRule[];
  ignore: Matcher[];
}

const ALLOWED_KEYS = new Set([
  "levels",
  "modules",
  "forbid",
  "foreign",
  "ignore",
]);

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

export function parsePolicy(yamlText: string): Policy {
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
    if (!ALLOWED_KEYS.has(key)) {
      errors.push(`policy: unknown key "${key}"`);
    }
  }

  const levels: string[] = [];
  const rawLevels = document.levels;

  if (!Array.isArray(rawLevels) || rawLevels.length === 0) {
    errors.push("levels: required, a non-empty list of level names");
  } else {
    for (const level of rawLevels) {
      if (!isNonEmptyString(level)) {
        errors.push("levels: every level must be a non-empty string");
      } else if (levels.includes(level)) {
        errors.push(`levels: duplicate level "${level}"`);
      } else {
        levels.push(level);
      }
    }
  }

  const modules = new Map<string, Matcher[]>();

  if (document.modules !== undefined) {
    if (!isPlainObject(document.modules)) {
      errors.push("modules: must map level names to globs");
    } else {
      for (const [level, value] of Object.entries(document.modules)) {
        if (!levels.includes(level)) {
          errors.push(`modules: "${level}" is not in levels`);
          continue;
        }

        const globs = readGlobList(value, `modules.${level}`, errors);
        modules.set(level, globs.map(compileGlob));
      }
    }
  }

  const forbid: ForbidRule[] = [];

  if (document.forbid !== undefined) {
    if (!Array.isArray(document.forbid)) {
      errors.push("forbid: must be a list of strings");
    } else {
      for (const entry of document.forbid) {
        const rule = parseForbid(entry, errors);

        if (rule) {
          forbid.push(rule);
        }
      }
    }
  }

  if (document.foreign !== undefined) {
    const foreign = document.foreign;

    if (!isPlainObject(foreign)) {
      errors.push("foreign: must map group names to lists of strings");
    } else {
      for (const [group, members] of Object.entries(foreign)) {
        if (
          !Array.isArray(members) ||
          !members.every((m) => typeof m === "string")
        ) {
          errors.push(`foreign.${group}: must be a list of strings`);
        }
      }
    }
  }

  let ignore: Matcher[] = [];

  if (document.ignore !== undefined) {
    if (!Array.isArray(document.ignore)) {
      errors.push("ignore: must be a list of globs");
    } else {
      ignore = readGlobList(document.ignore, "ignore", errors).map(compileGlob);
    }
  }

  if (errors.length > 0) {
    throw new InputError(errors);
  }

  return { levels, modules, forbid, ignore };
}

function parseForbid(entry: unknown, errors: string[]): ForbidRule | null {
  if (typeof entry !== "string") {
    errors.push("forbid: every entry must be a string");
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

  return { pattern: entry, from: compileGlob(from), to: compileGlob(to) };
}
