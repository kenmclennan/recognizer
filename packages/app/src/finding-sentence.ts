import type { Finding } from "@recognizer/core";
import {
  findingRecordOf,
  libraryApiHint,
  renderSentence,
  unusedTestOnlySentence,
} from "recognizer";
import { EMPTY_CATALOG, type FindingCatalog } from "./finding-catalog";

export type SentenceInput = {
  record: Finding;
  reported: boolean;
};

export function shortName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function ruleClause(
  rule: NonNullable<Finding["dependencies"]>[number]["rules"],
): string | null {
  const first = rule?.[0];

  if (first === undefined) {
    return null;
  }

  if (first.type === "level") {
    return `${first.fromLevel} may not use ${first.toLevel}`;
  }

  if (first.type === "uses") {
    return `${first.fromComponent} may not use ${first.toComponent}`;
  }

  return `nothing may match ${first.pattern}`;
}

function severalImports(edges: NonNullable<Finding["dependencies"]>): string {
  const first = edges[0] as (typeof edges)[number];
  const rule = first.rules?.[0];
  const kinds = new Set(edges.map((edge) => edge.kind ?? "depends"));
  const [only] = [...kinds];
  const verb =
    kinds.size === 1 && only !== undefined && only !== "depends"
      ? only
      : "imports";
  const target =
    rule === undefined || rule.type === "forbid"
      ? ""
      : ` from ${rule.type === "uses" ? rule.toComponent : rule.toLevel}`;
  const head = `${shortName(first.from)} ${verb} ${edges.length} files${target}`;
  const clause = ruleClause(first.rules);

  return clause === null
    ? `${head}, which the policy forbids.`
    : `${head}, which the policy forbids: ${clause}.`;
}

function violation(record: Finding): string | null {
  const edges = record.dependencies ?? [];
  const edge = edges[0];

  if (edge === undefined) {
    return null;
  }

  if (edges.length > 1) {
    return severalImports(edges);
  }

  const verb =
    edge.kind === undefined || edge.kind === "depends" ? "imports" : edge.kind;
  const clause = ruleClause(edge.rules);
  const head = `${shortName(edge.from)} ${verb} ${shortName(edge.to)}`;

  return clause === null
    ? `${head}, which the policy forbids.`
    : `${head}, which the policy forbids: ${clause}.`;
}

function cycle(record: Finding): string | null {
  const names = record.files.map(shortName);

  if (names.length < 2) {
    return null;
  }

  if (names.length === 2) {
    return `${names[0]} and ${names[1]} import each other.`;
  }

  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)} form a cycle of ${names.length}.`;
}

function unusedExports(record: Finding): string | null {
  const module = record.files[0];
  const names = (record.members ?? []).map((member) => member.name);

  if (module === undefined || names.length === 0) {
    return null;
  }

  const base = `${shortName(module)} exports ${names.length} ${plural(names.length, "name", "names")} no other file imports: ${names.join(", ")}.`;
  const marked = (record.members ?? []).flatMap((member) =>
    member.testFiles === undefined
      ? []
      : [{ name: member.name, testFiles: member.testFiles }],
  );

  return marked.length === 0
    ? base
    : `${base} ${unusedTestOnlySentence(marked)}`;
}

function sharedPrefix(members: NonNullable<Finding["members"]>): string | null {
  const files = new Set(members.map((member) => member.sourceFile));

  if (files.size !== 1 || files.has(undefined)) {
    return null;
  }

  const prefixes = new Set(
    members.map((member) =>
      member.name.slice(0, Math.max(0, member.name.lastIndexOf("."))),
    ),
  );
  const [only] = [...prefixes];

  return prefixes.size === 1 && only !== undefined && only !== "" ? only : null;
}

function duplication(record: Finding): string | null {
  const members = record.members ?? [];
  const [first, second, third] = members;

  if (first === undefined || second === undefined) {
    return null;
  }

  const sizes = members.flatMap((member) =>
    member.lines === undefined ? [] : [member.lines[1] - member.lines[0] + 1],
  );
  const tail = sizes.length === 0 ? "" : ` (${Math.max(...sizes)} lines)`;

  const prefix = sharedPrefix(members);

  if (third !== undefined && prefix !== null) {
    return `${members.length} methods of ${prefix} repeat one structure${tail}.`;
  }

  if (third === undefined) {
    return `${first.name} in ${shortName(first.file)} repeats the structure of ${second.name} in ${shortName(second.file)}${tail}.`;
  }

  const named = [first, second, third].map(
    (member) => `${member.name} in ${shortName(member.file)}`,
  );
  const rest = members.length - 3;
  const list =
    rest === 0
      ? `${named[0]}, ${named[1]} and ${named[2]}`
      : `${named.join(", ")} and ${rest} more`;

  return `${members.length} functions repeat one structure: ${list}${tail}.`;
}

function longFunction(record: Finding): string | null {
  const member = record.members?.[0];
  const lines = record.measures?.lines;

  if (member === undefined || lines === undefined) {
    return null;
  }

  const limit = record.measures?.limit ?? 20;

  if (record.measures?.body_line !== undefined) {
    return `${member.name} has a ${num(lines)}-line body, over the limit of ${num(limit)}.`;
  }

  return `${member.name} is ${num(lines)} lines, over the limit of ${num(limit)}.`;
}

function complexity(record: Finding): string | null {
  const member = record.members?.[0];
  const measures = record.measures;

  if (
    member === undefined ||
    measures?.complexity === undefined ||
    measures.limit === undefined
  ) {
    return null;
  }

  return `${member.name} has complexity ${num(measures.complexity)}, over the limit of ${num(measures.limit)}.`;
}

function orphan(record: Finding): string | null {
  const module = record.files[0];

  if (module === undefined) {
    return null;
  }

  const tests = record.testImporters?.length ?? 0;
  const hint = `${libraryApiHint(module)}.`;

  if (tests === 0) {
    return `${shortName(module)} is imported by nothing and is not an entry point${hint}`;
  }

  return `${shortName(module)} is imported only by ${tests === 1 ? "1 test file" : `${tests} test files`} and is not an entry point; if it only supports tests, move it next to ${tests === 1 ? "it" : "them"}${hint}`;
}

function privateImports(record: Finding): string | null {
  const module = record.files[0];
  const members = record.members ?? [];

  if (module === undefined || members.length === 0) {
    return null;
  }

  const owners = new Set(members.map((member) => member.file)).size;

  return `${shortName(module)} imports ${members.length} private ${plural(members.length, "name", "names")} from ${owners} ${plural(owners, "file", "files")}.`;
}

const TEMPLATES: Record<string, (record: Finding) => string | null> = {
  "rule-violation": violation,
  cycle,
  orphan,
  unused_exports: unusedExports,
  private_imports: privateImports,
  long_function: longFunction,
  complexity,
  duplication,
};

export function sentenceOf(
  input: SentenceInput,
  catalog: FindingCatalog = EMPTY_CATALOG,
): string {
  const { record, reported } = input;

  if (reported) {
    return record.summary;
  }

  const planned = catalog.groupFor(record.kind);

  if (planned !== undefined) {
    return renderSentence(
      {
        kind: planned.pattern,
        group: { name: planned.name, ...planned.help },
        help: "",
        sentence: planned.sentence,
      },
      findingRecordOf(record),
    );
  }

  return TEMPLATES[record.kind]?.(record) ?? record.summary;
}
