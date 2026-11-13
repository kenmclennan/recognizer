export type Condition =
  | { has: string }
  | { path: string; is: string }
  | { left: string; op: "gt" | "lt" | "eq"; right: string };

export interface Variant {
  when?: Condition[];
  text: string;
}

export interface Sentence {
  requires: string[];
  parts: Variant[][];
}

export interface FindingEntry {
  kind: string;
  group: { name: string; means: string; todo: string };
  help: string;
  sentence: Sentence;
}

export interface SentenceRecord {
  kind: string;
  summary: string;
}

const PATH = /^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$/;
const SLOT = /\{([^{}]*)\}/g;
const PLURAL = /^plural:[^:{}|]*:[^:{}|]*$/;
const FORMATS = ["short", "num", "whole", "percent"];

export function matchKind(
  entryKind: string,
  recordKind: string,
): Record<string, string> | null {
  const wanted = entryKind.split(".");
  const actual = recordKind.split(".");

  if (wanted.length !== actual.length) {
    return null;
  }

  const bindings: Record<string, string> = {};

  for (const [index, segment] of wanted.entries()) {
    const value = actual[index] as string;
    const placeholder = /^<([a-z][a-z0-9_]*)>$/.exec(segment);

    if (placeholder !== null) {
      bindings[placeholder[1] as string] = value;
    } else if (segment !== value) {
      return null;
    }
  }

  return bindings;
}

function lookup(
  path: string,
  record: SentenceRecord,
  bindings: Record<string, string>,
): unknown {
  if (Object.hasOwn(bindings, path)) {
    return bindings[path];
  }

  let current: unknown = record;

  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function holds(
  condition: Condition,
  record: SentenceRecord,
  bindings: Record<string, string>,
): boolean {
  if ("has" in condition) {
    return present(lookup(condition.has, record, bindings));
  }

  if ("is" in condition) {
    return lookup(condition.path, record, bindings) === condition.is;
  }

  const left = lookup(condition.left, record, bindings);
  const right = lookup(condition.right, record, bindings);

  if (typeof left !== "number" || typeof right !== "number") {
    return false;
  }

  if (condition.op === "gt") {
    return left > right;
  }

  return condition.op === "lt" ? left < right : left === right;
}

function format(value: unknown, how: string | undefined): string {
  if (how === undefined) {
    return String(value);
  }

  if (how === "short") {
    const text = String(value);

    return text.slice(text.lastIndexOf("/") + 1);
  }

  if (how.startsWith("plural:")) {
    const [, one, many] = how.split(":") as [string, string, string];

    return Number(value) === 1 ? one : many;
  }

  const number = Number(value);

  if (how === "num") {
    return String(Math.round(number * 100) / 100);
  }

  return how === "whole"
    ? String(Math.round(number))
    : String(Math.round(number * 100));
}

function fill(
  text: string,
  record: SentenceRecord,
  bindings: Record<string, string>,
): string {
  return text.replace(SLOT, (_, slot: string) => {
    const bar = slot.indexOf("|");
    const path = bar === -1 ? slot : slot.slice(0, bar);
    const how = bar === -1 ? undefined : slot.slice(bar + 1);

    return format(lookup(path, record, bindings), how);
  });
}

export function renderSentence(
  entry: FindingEntry,
  record: SentenceRecord,
): string {
  const bindings = matchKind(entry.kind, record.kind);

  if (
    bindings === null ||
    entry.sentence.requires.some(
      (path) => !present(lookup(path, record, bindings)),
    )
  ) {
    return record.summary;
  }

  return entry.sentence.parts
    .map((part) => {
      const chosen = part.find((variant) =>
        (variant.when ?? []).every((condition) =>
          holds(condition, record, bindings),
        ),
      );

      return chosen === undefined ? "" : fill(chosen.text, record, bindings);
    })
    .join("");
}

function conditionPaths(condition: Condition): string[] {
  if ("has" in condition) {
    return [condition.has];
  }

  return "is" in condition
    ? [condition.path]
    : [condition.left, condition.right];
}

export function sentenceProblems(sentence: Sentence): string[] {
  const problems: string[] = [];
  const paths = [...sentence.requires];

  for (const part of sentence.parts) {
    for (const variant of part) {
      for (const condition of variant.when ?? []) {
        paths.push(...conditionPaths(condition));
      }

      for (const match of variant.text.matchAll(SLOT)) {
        const slot = match[1] as string;
        const bar = slot.indexOf("|");
        const how = bar === -1 ? undefined : slot.slice(bar + 1);

        paths.push(bar === -1 ? slot : slot.slice(0, bar));

        if (how !== undefined && !FORMATS.includes(how) && !PLURAL.test(how)) {
          problems.push(`slot {${slot}} has the unknown format ${how}`);
        }
      }
    }
  }

  for (const path of paths) {
    if (!PATH.test(path)) {
      problems.push(`${path} is not a dotted path`);
    }
  }

  return problems;
}
