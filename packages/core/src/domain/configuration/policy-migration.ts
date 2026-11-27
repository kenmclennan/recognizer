export interface RetiredPolicy {
  components: Map<string, string[]>;
  levels: string[];
  uses: Map<string, string[]> | null;
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isLiteralPath(glob: string): boolean {
  return !glob.includes("*") && !glob.includes("?");
}

export function readGlobs(
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

function readComponents(
  raw: Record<string, unknown>,
  errors: string[],
): Map<string, string[]> {
  const components = new Map<string, string[]>();

  if (raw.components === undefined) {
    return components;
  }

  if (!isPlainObject(raw.components)) {
    errors.push("components: must map component names to globs");

    return components;
  }

  for (const [name, value] of Object.entries(raw.components)) {
    if (name.trim() === "") {
      errors.push("components: every name must be non-empty");
    } else {
      components.set(name, readGlobs(value, `components.${name}`, errors));
    }
  }

  return components;
}

function readLevels(
  raw: Record<string, unknown>,
  components: Map<string, string[]>,
  errors: string[],
): string[] {
  const levels: string[] = [];

  if (raw.levels === undefined) {
    return levels;
  }

  if (!Array.isArray(raw.levels) || raw.levels.length === 0) {
    errors.push("levels: must be a non-empty list of component names");

    return levels;
  }

  for (const level of raw.levels) {
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

  return levels;
}

function readUses(
  raw: Record<string, unknown>,
  components: Map<string, string[]>,
  errors: string[],
): Map<string, string[]> | null {
  if (raw.uses === undefined) {
    return null;
  }

  if (!isPlainObject(raw.uses) || Object.keys(raw.uses).length === 0) {
    errors.push("uses: must be a non-empty map of component names to lists");

    return null;
  }

  const uses = new Map<string, string[]>();

  for (const [name, allowed] of Object.entries(raw.uses)) {
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

  return uses;
}

export function readRetired(
  raw: Record<string, unknown>,
): RetiredPolicy | string[] {
  const errors: string[] = [];
  const components = readComponents(raw, errors);
  const levels = readLevels(raw, components, errors);
  const uses = readUses(raw, components, errors);

  return errors.length > 0 ? errors : { components, levels, uses };
}

function forbidden(retired: RetiredPolicy, from: string, to: string): boolean {
  if (retired.levels.length === 0 && retired.uses === null) {
    return false;
  }

  const fromIndex = retired.levels.indexOf(from);
  const toIndex = retired.levels.indexOf(to);

  if (fromIndex >= 0 && toIndex >= 0 && fromIndex >= toIndex) {
    return false;
  }

  return retired.uses?.get(from)?.includes(to) !== true;
}

export interface MigratedRule {
  from: string[];
  to: string[];
}

export function migratedRules(retired: RetiredPolicy): MigratedRule[] {
  const rules: MigratedRule[] = [];

  for (const [from, fromGlobs] of retired.components) {
    const to: string[] = [];

    for (const [target, targetGlobs] of retired.components) {
      if (target !== from && forbidden(retired, from, target)) {
        to.push(...targetGlobs);
      }
    }

    if (to.length > 0) {
      rules.push({ from: fromGlobs, to });
    }
  }

  return rules;
}

export function literalPaths(retired: RetiredPolicy): string[] {
  const paths: string[] = [];

  for (const globs of retired.components.values()) {
    for (const glob of globs) {
      if (isLiteralPath(glob) && !paths.includes(glob)) {
        paths.push(glob);
      }
    }
  }

  return paths;
}
