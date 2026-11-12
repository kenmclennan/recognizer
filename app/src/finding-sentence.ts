import {
  type FindingRecord,
  libraryApiHint,
  unusedTestOnlySentence,
} from "recognizer";

export type SentenceInput = {
  record: FindingRecord;
  reported: boolean;
};

export function shortName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function whole(value: number): string {
  return String(Math.round(value));
}

function after(id: string, prefix: string): string {
  return id.startsWith(prefix) ? id.slice(prefix.length) : "";
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function ruleClause(
  rule: NonNullable<FindingRecord["evidence"]["edges"]>[number]["rules"],
): string | null {
  const first = rule?.[0];

  if (first === undefined) {
    return null;
  }

  if (first.type === "level") {
    return `${first.from_level} may not use ${first.to_level}`;
  }

  if (first.type === "uses") {
    return `${first.from_component} may not use ${first.to_component}`;
  }

  return `nothing may match ${first.pattern}`;
}

function violation(record: FindingRecord): string | null {
  const edge = record.evidence.edges?.[0];

  if (edge === undefined) {
    return null;
  }

  const verb =
    edge.kind === undefined || edge.kind === "depends" ? "imports" : edge.kind;
  const clause = ruleClause(edge.rules);
  const head = `${shortName(edge.from)} ${verb} ${shortName(edge.to)}`;

  return clause === null
    ? `${head}, which the policy forbids.`
    : `${head}, which the policy forbids: ${clause}.`;
}

function cycle(record: FindingRecord): string | null {
  const names = record.evidence.modules.map(shortName);

  if (names.length < 2) {
    return null;
  }

  if (names.length === 2) {
    return `${names[0]} and ${names[1]} import each other.`;
  }

  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)} form a cycle of ${names.length}.`;
}

function hub(record: FindingRecord): string | null {
  const measures = record.evidence.measures;
  const module = record.evidence.modules[0];

  if (
    measures?.fan_in === undefined ||
    measures.fan_out === undefined ||
    measures.threshold === undefined ||
    module === undefined
  ) {
    return null;
  }

  const counts = `${shortName(module)} is imported by ${num(measures.fan_in)} modules and imports ${num(measures.fan_out)}`;
  const { lines, members } = measures;

  if (lines === undefined && members === undefined) {
    return `${counts}; the limit is ${num(measures.threshold)}.`;
  }

  const size =
    lines !== undefined && members !== undefined
      ? `it is ${num(lines)} lines with ${num(members)} members`
      : members !== undefined
        ? `it has ${num(members)} members`
        : `it is ${num(lines as number)} lines`;

  return `${counts}; ${size}; the limit is ${num(measures.threshold)}.`;
}

function drift(record: FindingRecord): string | null {
  const entry = after(record.id, "policy_drift:entry:");

  if (entry !== "") {
    return `The policy names ${entry}, which matches no module.`;
  }

  const folder = after(record.id, "policy_drift:folder:");

  return folder === "" ? null : `${folder} is covered by no policy layer.`;
}

function unusedExports(record: FindingRecord): string | null {
  const module = record.evidence.modules[0];
  const names = (record.evidence.members ?? []).map((member) => member.name);

  if (module === undefined || names.length === 0) {
    return null;
  }

  const base = `${shortName(module)} exports ${names.length} ${plural(names.length, "name", "names")} no other module imports: ${names.join(", ")}.`;
  const marked = (record.evidence.members ?? []).flatMap((member) =>
    member.test_files === undefined
      ? []
      : [{ name: member.name, testFiles: member.test_files }],
  );

  return marked.length === 0
    ? base
    : `${base} ${unusedTestOnlySentence(marked)}`;
}

function sharedPrefix(
  members: NonNullable<FindingRecord["evidence"]["members"]>,
): string | null {
  const files = new Set(members.map((member) => member.file));

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

function duplication(record: FindingRecord): string | null {
  const members = record.evidence.members ?? [];
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
    return `${first.name} in ${shortName(first.module)} repeats the structure of ${second.name} in ${shortName(second.module)}${tail}.`;
  }

  const named = [first, second, third].map(
    (member) => `${member.name} in ${shortName(member.module)}`,
  );
  const rest = members.length - 3;
  const list =
    rest === 0
      ? `${named[0]}, ${named[1]} and ${named[2]}`
      : `${named.join(", ")} and ${rest} more`;

  return `${members.length} functions repeat one structure: ${list}${tail}.`;
}

function crap(record: FindingRecord): string | null {
  const member = record.evidence.members?.[0];
  const measures = record.evidence.measures;

  if (member === undefined || measures?.complexity === undefined) {
    return null;
  }

  const head = `${member.name} in ${shortName(member.module)} has complexity ${num(measures.complexity)}`;

  if (measures.coverage === undefined || measures.crap === undefined) {
    return `${head} and unknown coverage.`;
  }

  return `${head} and ${whole(measures.coverage * 100)}% coverage, C.R.A.P. ${whole(measures.crap)}.`;
}

function mutation(record: FindingRecord): string | null {
  const member = record.evidence.members?.[0];
  const survived = record.evidence.measures?.survived;

  if (member === undefined || survived === undefined) {
    return null;
  }

  return `${member.name} in ${shortName(member.module)} has ${num(survived)} surviving ${plural(survived, "mutation", "mutations")}.`;
}

function threshold(record: FindingRecord): string | null {
  const measures = record.evidence.measures;
  const metric = record.kind.slice("thresholds.".length);
  const member = record.evidence.members?.[0];
  const module = member?.module ?? record.evidence.modules[0];

  if (
    measures?.value === undefined ||
    measures.line === undefined ||
    module === undefined
  ) {
    return null;
  }

  const subject =
    member === undefined
      ? shortName(module)
      : `${member.name} in ${shortName(module)}`;
  const limit =
    measures.value > measures.line
      ? "over the limit of"
      : measures.value < measures.line
        ? "under the limit of"
        : "at the limit of";

  return `${subject} has ${metric} ${num(measures.value)}, ${limit} ${num(measures.line)}.`;
}

function orphan(record: FindingRecord): string | null {
  const module = record.evidence.modules[0];

  if (module === undefined) {
    return null;
  }

  const tests = record.evidence.test_importers?.length ?? 0;
  const hint = `${libraryApiHint(module) ?? ""}.`;

  if (tests === 0) {
    return `${shortName(module)} is imported by nothing and is not an entry point${hint}`;
  }

  return `${shortName(module)} is imported only by ${tests === 1 ? "1 test file" : `${tests} test files`} and is not an entry point; if it only supports tests, move it next to ${tests === 1 ? "it" : "them"}${hint}`;
}

const TEMPLATES: Record<string, (record: FindingRecord) => string | null> = {
  "rule-violation": violation,
  cycle,
  hub,
  orphan,
  policy_drift: drift,
  unused_exports: unusedExports,
  duplication,
  crap,
  mutation,
};

export function sentenceOf(input: SentenceInput): string {
  const { record, reported } = input;

  if (reported) {
    return record.summary;
  }

  const build = record.kind.startsWith("thresholds.")
    ? threshold
    : TEMPLATES[record.kind];

  return build?.(record) ?? record.summary;
}
