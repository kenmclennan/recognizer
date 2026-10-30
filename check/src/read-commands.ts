import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { readConfig } from "./config.js";
import { InputError } from "./errors.js";
import { type Finding, findingsByModule } from "./findings.js";
import { freshScans } from "./freshness.js";
import {
  moduleCounts,
  moduleNames,
  neighbourSets,
  under,
} from "./neighbours.js";
import { type Policy, parsePolicy } from "./policy.js";
import {
  lineStatus,
  type ResponsibilityEntry,
  validateResponsibilities,
} from "./responsibilities.js";
import type { Scan, ScanMember } from "./scan.js";
import {
  fieldSignature,
  memberSignature,
  methodSignature,
} from "./signatures.js";

const DEFAULT_HUB_THRESHOLD = 10;
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface Loaded {
  root: string;
  json: boolean;
  scans: Scan[];
  modules: string[];
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
}

function load(
  argv: string[],
  io: Io,
  usage: string,
  arity: number,
  extra: Record<string, { type: "string" | "boolean" }>,
): Loaded {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean" },
      repository: { type: "string" },
      ...extra,
    },
  });

  if (positionals.length !== arity) {
    throw new InputError([`usage: ${usage}`]);
  }

  const root = resolve((values.repository as string | undefined) ?? ".");
  const { scans } = freshScans(io, root);

  return {
    root,
    json: values.json === true,
    scans,
    modules: moduleNames(scans),
    values,
    positionals,
  };
}

function readPolicy(io: Io, root: string): Policy | null {
  const file = join(root, ".recognizer", "policy.yaml");

  if (!io.exists(file)) {
    return null;
  }

  return parsePolicy(io.readFile(file));
}

function hubThreshold(raw: unknown): number {
  if (raw === undefined) {
    return DEFAULT_HUB_THRESHOLD;
  }

  if (typeof raw !== "string" || !/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new InputError([`--hub-threshold must be an integer >= 1: ${raw}`]);
  }

  return Number(raw);
}

function findingsOf(loaded: Loaded, io: Io): Map<string, Finding[]> {
  return findingsByModule(
    loaded.scans,
    readPolicy(io, loaded.root),
    hubThreshold(loaded.values["hub-threshold"]),
  );
}

function row(parts: (string | number | undefined)[]): string {
  return parts.filter((part) => part !== undefined).join("  ");
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function kindOf(scans: Scan[], id: string): string {
  for (const scan of scans) {
    const found = scan.modules.find((module) => module.id === id);

    if (found !== undefined) {
      return found.kind;
    }
  }

  return "module";
}

function print(io: Io, loaded: Loaded, document: unknown, text: string[]) {
  io.stdout(
    loaded.json
      ? `${JSON.stringify(document, null, 2)}\n`
      : `${text.join("\n")}\n`,
  );
}

const FIND_USAGE = "recognizer find <text> [--repository <dir>] [--json]";

export function runFind(argv: string[], io: Io): number {
  const loaded = load(argv, io, FIND_USAGE, 1, {});
  const text = loaded.positionals[0] as string;
  const needle = text.toLowerCase();
  const modules: { id: string; kind: string }[] = [];
  const members: {
    module: string;
    name: string;
    kind?: string;
    line?: number;
    exported: boolean;
  }[] = [];
  const seen = new Set<string>();

  for (const scan of loaded.scans) {
    for (const module of scan.modules) {
      if (seen.has(module.id)) {
        continue;
      }

      seen.add(module.id);

      if (module.id.toLowerCase().includes(needle)) {
        modules.push({ id: module.id, kind: module.kind });
      }

      for (const member of module.members ?? []) {
        if (member.name.toLowerCase().includes(needle)) {
          members.push({
            module: module.id,
            name: member.name,
            kind: member.kind,
            line: member.line,
            exported: member.exported,
          });
        }
      }
    }
  }

  modules.sort((a, b) => byId(a.id, b.id));
  members.sort(
    (a, b) => byId(a.module, b.module) || (a.line ?? 0) - (b.line ?? 0),
  );

  const lines = [
    `${plural(modules.length, "module")}, ${plural(members.length, "member")} matched`,
  ];

  if (modules.length > 0) {
    lines.push("modules", ...modules.map((module) => `  ${module.id}`));
  }

  if (members.length > 0) {
    lines.push(
      "members",
      ...members.map(
        (member) =>
          `  ${member.module}::${member.name}${member.kind === undefined ? "" : `  ${member.kind}`}${member.line === undefined ? "" : `  line ${member.line}`}`,
      ),
    );
  }

  print(io, loaded, { text, modules, members }, lines);

  return 0;
}

type Status = "current" | "out-of-date" | "missing" | "unchecked";

function responsibilityOf(
  io: Io,
  root: string,
  id: string,
): { status: Status; line: string | null } {
  const file = join(root, ".recognizer", "responsibilities.json");
  let entries: Record<string, ResponsibilityEntry> = {};

  if (io.exists(file)) {
    try {
      entries = validateResponsibilities(JSON.parse(io.readFile(file))).modules;
    } catch {
      return { status: "unchecked", line: null };
    }
  }

  const entry = entries[id];

  if (entry === undefined) {
    return { status: "missing", line: null };
  }

  let describer: { command: string[]; version: string } | undefined;

  try {
    describer = readConfig(io, root)?.describer;
  } catch {
    describer = undefined;
  }

  if (describer === undefined) {
    return { status: "unchecked", line: entry.line };
  }

  try {
    const hash = createHash("sha256")
      .update(io.readFile(join(root, id)), "utf8")
      .digest("hex");
    const status = lineStatus(
      entry,
      hash,
      describer.command,
      describer.version,
    ).status;

    return { status: status as Status, line: entry.line };
  } catch {
    return { status: "unchecked", line: entry.line };
  }
}

interface ShownMember {
  name: string;
  kind?: string;
  line?: number;
  visibility: string;
  signature: string;
  fields?: { signature: string; line: number; private: boolean }[];
  methods?: { signature: string; line?: number; private: boolean }[];
}

function shownMembers(
  members: ScanMember[],
  withPrivate: boolean,
): { shown: ShownMember[]; hidden: number } {
  const shown: ShownMember[] = [];
  let hidden = 0;

  for (const member of members) {
    if (!member.exported && !withPrivate) {
      hidden += 1;

      continue;
    }

    const fields = (member.fields ?? []).filter(
      (field) => withPrivate || !field.private,
    );
    const methods = (member.methods ?? []).filter(
      (method) => withPrivate || method.private !== true,
    );

    hidden +=
      (member.fields?.length ?? 0) -
      fields.length +
      ((member.methods?.length ?? 0) - methods.length);

    shown.push({
      name: member.name,
      kind: member.kind,
      line: member.line,
      visibility: member.visibility ?? (member.exported ? "public" : "private"),
      signature: memberSignature(member),
      ...(member.fields === undefined
        ? {}
        : {
            fields: fields.map((field) => ({
              signature: fieldSignature(field),
              line: field.line,
              private: field.private,
            })),
          }),
      ...(member.methods === undefined
        ? {}
        : {
            methods: methods.map((method) => ({
              signature: methodSignature(method),
              line: method.line,
              private: method.private === true,
            })),
          }),
    });
  }

  return { shown, hidden };
}

const SHOW_USAGE =
  "recognizer show <module> [--private] [--hub-threshold <n>] [--repository <dir>] [--json]";

export function runShow(argv: string[], io: Io): number {
  const loaded = load(argv, io, SHOW_USAGE, 1, {
    private: { type: "boolean" },
    "hub-threshold": { type: "string" },
  });
  const id = loaded.positionals[0] as string;

  if (!loaded.modules.includes(id)) {
    throw new InputError([`no such module: ${id}`]);
  }

  const sets = neighbourSets(
    loaded.scans.flatMap((scan) => scan.edges),
    new Set(loaded.modules),
  );
  const counts = moduleCounts(sets, id);
  const scanned = loaded.scans
    .flatMap((scan) => scan.modules)
    .find((module) => module.id === id);
  const { shown, hidden } = shownMembers(
    scanned?.members ?? [],
    loaded.values.private === true,
  );
  const responsibility = responsibilityOf(io, loaded.root, id);
  const findings = findingsOf(loaded, io).get(id) ?? [];
  const kind = kindOf(loaded.scans, id);
  const document = {
    module: id,
    kind,
    uses: counts.uses,
    usedBy: counts.usedBy,
    responsibility,
    members: shown,
    hiddenPrivate: hidden,
    findings,
  };
  const lines = [
    `${id}  ${kind}  uses ${counts.uses}  used by ${counts.usedBy}`,
    `responsibility:${responsibility.status === "current" ? "" : ` [${responsibility.status}]`} ${responsibility.line ?? ""}`.trimEnd(),
  ];

  for (const member of shown) {
    lines.push(
      row([member.line, member.visibility, member.kind, member.signature]),
    );

    for (const field of member.fields ?? []) {
      lines.push(
        `    ${row([field.line, field.private ? "private" : "public", "field", field.signature])}`,
      );
    }

    for (const method of member.methods ?? []) {
      lines.push(
        `    ${row([method.line, method.private ? "private" : "public", "method", method.signature])}`,
      );
    }
  }

  if (hidden > 0) {
    lines.push(`${hidden} private hidden`);
  }

  if (findings.length === 0) {
    lines.push("no findings");
  } else {
    lines.push(
      "findings:",
      ...findings.map(
        (finding) => `  ${finding.severity}  ${finding.text}  (${finding.why})`,
      ),
    );
  }

  print(io, loaded, document, lines);

  return 0;
}

const SORTS = ["id", "uses", "used-by", "findings"] as const;
type Sort = (typeof SORTS)[number];

const MODULES_USAGE =
  "recognizer modules [--folder <path>] [--findings] [--min-uses <n>] [--min-used-by <n>] [--sort <id|uses|used-by|findings>] [--reverse] [--limit <n>] [--hub-threshold <n>] [--repository <dir>] [--json]";

function integer(raw: unknown, flag: string, minimum: number): number | null {
  if (raw === undefined) {
    return null;
  }

  if (typeof raw !== "string" || !/^\d+$/.test(raw) || Number(raw) < minimum) {
    throw new InputError([`${flag} must be an integer >= ${minimum}: ${raw}`]);
  }

  return Number(raw);
}

export function runModules(argv: string[], io: Io): number {
  const loaded = load(argv, io, MODULES_USAGE, 0, {
    folder: { type: "string" },
    findings: { type: "boolean" },
    "min-uses": { type: "string" },
    "min-used-by": { type: "string" },
    sort: { type: "string" },
    reverse: { type: "boolean" },
    limit: { type: "string" },
    "hub-threshold": { type: "string" },
  });
  const { values } = loaded;
  const minUses = integer(values["min-uses"], "--min-uses", 0);
  const minUsedBy = integer(values["min-used-by"], "--min-used-by", 0);
  const limit = integer(values.limit, "--limit", 1);
  const sort = (values.sort ?? "id") as Sort;

  if (!SORTS.includes(sort)) {
    throw new InputError([
      `--sort must be one of ${SORTS.join(", ")}: ${values.sort}`,
    ]);
  }

  const sets = neighbourSets(
    loaded.scans.flatMap((scan) => scan.edges),
    new Set(loaded.modules),
  );
  const findings = findingsOf(loaded, io);
  const folder = (values.folder as string | undefined)?.replace(/\/+$/, "");
  const all = loaded.modules.map((id) => ({
    id,
    kind: kindOf(loaded.scans, id),
    uses: moduleCounts(sets, id).uses,
    usedBy: moduleCounts(sets, id).usedBy,
    findings: findings.get(id)?.length ?? 0,
  }));
  const kept = all.filter(
    (row) =>
      (folder === undefined || under(row.id, folder)) &&
      (values.findings !== true || row.findings > 0) &&
      (minUses === null || row.uses >= minUses) &&
      (minUsedBy === null || row.usedBy >= minUsedBy),
  );
  const key: Record<Sort, (row: (typeof all)[number]) => number> = {
    id: () => 0,
    uses: (row) => row.uses,
    "used-by": (row) => row.usedBy,
    findings: (row) => row.findings,
  };

  kept.sort((a, b) =>
    sort === "id"
      ? byId(a.id, b.id)
      : key[sort](b) - key[sort](a) || byId(a.id, b.id),
  );

  if (values.reverse === true) {
    kept.reverse();
  }

  const rows = limit === null ? kept : kept.slice(0, limit);
  const lines = [
    `${rows.length} of ${all.length} modules`,
    ...rows.map(
      (row) =>
        `${row.id}  ${row.kind}  uses ${row.uses}  used by ${row.usedBy}  findings ${row.findings}`,
    ),
  ];

  print(
    io,
    loaded,
    { total: all.length, count: rows.length, modules: rows },
    lines,
  );

  return 0;
}
