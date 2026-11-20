import {
  type Document,
  isMap,
  isSeq,
  parseDocument,
  type YAMLMap,
  YAMLSeq,
} from "yaml";
import { emit } from "./config-edit.js";
import { RETIRED_KEYS } from "./policy.js";

export type MigrateOutcome =
  | { status: "ok"; text: string; changes: string[] }
  | { status: "refused"; messages: string[] };

interface Retired {
  components: Map<string, string[]>;
  levels: string[];
  uses: Map<string, string[]> | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isLiteralPath(glob: string): boolean {
  return !glob.includes("*") && !glob.includes("?");
}

function readGlobs(value: unknown, where: string, errors: string[]): string[] {
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

function readRetired(raw: Record<string, unknown>): Retired | string[] {
  const errors: string[] = [];
  const components = readComponents(raw, errors);
  const levels = readLevels(raw, components, errors);
  const uses = readUses(raw, components, errors);

  return errors.length > 0 ? errors : { components, levels, uses };
}

function forbidden(retired: Retired, from: string, to: string): boolean {
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

export function migratedRules(retired: Retired): MigratedRule[] {
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

function literalPaths(retired: Retired): string[] {
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

function flowSeq(doc: Document, items: string[]): YAMLSeq {
  const seq = doc.createNode(items) as YAMLSeq;

  seq.flow = true;

  return seq;
}

export function ruleNode(doc: Document, rule: MigratedRule): YAMLMap {
  const node = doc.createNode({}) as YAMLMap;

  node.set("from", flowSeq(doc, rule.from));
  node.set("to", flowSeq(doc, rule.to));

  return node;
}

export function appendRules(doc: Document, rules: MigratedRule[]): void {
  const root = doc.contents as YAMLMap;
  const existing = root.get("forbid", true);

  if (isSeq(existing)) {
    for (const rule of rules) {
      existing.add(ruleNode(doc, rule));
    }

    return;
  }

  const seq = new YAMLSeq();

  for (const rule of rules) {
    seq.add(ruleNode(doc, rule));
  }

  root.set("forbid", seq);
}

function addEntry(doc: Document, paths: string[]): void {
  const root = doc.contents as YAMLMap;
  const components = root.items.find(
    (pair) => (pair.key as { value?: unknown }).value === "components",
  );
  const existing = root.get("entry", true);

  if (isSeq(existing)) {
    for (const path of paths) {
      if (
        !existing.items.some(
          (item) => (item as { value?: unknown }).value === path,
        )
      ) {
        existing.add(doc.createNode(path));
      }
    }

    if (components !== undefined) {
      root.delete("components");
    }

    return;
  }

  if (components !== undefined) {
    components.key = doc.createNode("entry");
    components.value = paths.length > 0 ? doc.createNode(paths) : null;

    if (paths.length === 0) {
      root.delete("entry");
    }

    return;
  }

  if (paths.length > 0) {
    root.set("entry", doc.createNode(paths));
  }
}

export function migratePolicy(text: string): MigrateOutcome {
  const doc = parseDocument(text);
  const parseError = doc.errors[0];

  if (parseError !== undefined) {
    return {
      status: "refused",
      messages: [`policy is not valid YAML: ${parseError.message}`],
    };
  }

  const raw: unknown = doc.toJS();

  if (!isPlainObject(raw) || !isMap(doc.contents)) {
    return { status: "ok", text, changes: [] };
  }

  const present = Object.keys(raw).filter((key) =>
    (RETIRED_KEYS as readonly string[]).includes(key),
  );

  if (present.length === 0) {
    return { status: "ok", text, changes: [] };
  }

  const retired = readRetired(raw);

  if (Array.isArray(retired)) {
    return { status: "refused", messages: retired };
  }

  const rules = migratedRules(retired);
  const paths = literalPaths(retired);
  const root = doc.contents;
  const header = (root.items[0]?.key as { commentBefore?: string } | undefined)
    ?.commentBefore;

  addEntry(doc, paths);
  root.delete("levels");
  root.delete("uses");
  root.delete("foreign");

  if (rules.length > 0) {
    appendRules(doc, rules);
  }

  const first = root.items[0] as { key: unknown } | undefined;

  if (first !== undefined && typeof first.key === "string") {
    first.key = doc.createNode(first.key);
  }

  const head = first?.key as
    | { spaceBefore?: boolean; commentBefore?: string }
    | undefined;

  if (head !== undefined) {
    head.spaceBefore = false;

    if (header !== undefined && head.commentBefore === undefined) {
      head.commentBefore = header;
    }
  }

  const changes = [
    `removed ${present.join(", ")}`,
    ...(paths.length > 0 ? [`entry: ${paths.join(", ")}`] : []),
    ...rules.map(
      (rule) => `forbid: ${rule.from.join(", ")} -> ${rule.to.join(", ")}`,
    ),
  ];

  return { status: "ok", text: emit(doc, text), changes };
}
