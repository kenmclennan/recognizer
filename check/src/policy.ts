import { parse } from "yaml";
import { InputError } from "./errors.js";
import { compileGlob, type Matcher } from "./glob.js";

export interface ForbidRule {
  pattern: string;
  from: Matcher;
  to: Matcher;
}

export interface Policy {
  components: Map<string, Matcher[]>;
  levels: string[];
  uses: Map<string, string[]> | null;
  forbid: ForbidRule[];
  ignore: Matcher[];
}

const ALLOWED_KEYS = new Set([
  "components",
  "levels",
  "uses",
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

  const components = new Map<string, Matcher[]>();

  if (document.components !== undefined) {
    if (!isPlainObject(document.components)) {
      errors.push("components: must map component names to globs");
    } else {
      for (const [name, value] of Object.entries(document.components)) {
        if (name.trim() === "") {
          errors.push("components: every name must be non-empty");
          continue;
        }

        const globs = readGlobList(value, `components.${name}`, errors);
        components.set(name, globs.map(compileGlob));
      }
    }
  }

  const levels: string[] = [];

  if (document.levels !== undefined) {
    if (!Array.isArray(document.levels) || document.levels.length === 0) {
      errors.push("levels: must be a non-empty list of component names");
    } else {
      for (const level of document.levels) {
        if (!isNonEmptyString(level)) {
          errors.push("levels: every level must be a non-empty string");
        } else if (levels.includes(level)) {
          errors.push(`levels: duplicate level "${level}"`);
        } else if (!components.has(level)) {
          errors.push(`levels: "${level}" is not in components`);
        } else {
          levels.push(level);
        }
      }
    }
  }

  let uses: Map<string, string[]> | null = null;

  if (document.uses !== undefined) {
    if (
      !isPlainObject(document.uses) ||
      Object.keys(document.uses).length === 0
    ) {
      errors.push("uses: must be a non-empty map of component names to lists");
    } else {
      uses = new Map<string, string[]>();

      for (const [name, allowed] of Object.entries(document.uses)) {
        if (!components.has(name)) {
          errors.push(`uses: "${name}" is not in components`);
        }

        if (
          !Array.isArray(allowed) ||
          !allowed.every((entry) => typeof entry === "string")
        ) {
          errors.push(`uses.${name}: must be a list of component names`);
          continue;
        }

        for (const target of allowed) {
          if (!components.has(target)) {
            errors.push(`uses.${name}: "${target}" is not in components`);
          }
        }

        uses.set(name, allowed);
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

  return { components, levels, uses, forbid, ignore };
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
