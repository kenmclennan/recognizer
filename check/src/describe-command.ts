import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { readConfig } from "./config.js";
import { InputError } from "./errors.js";
import { freshScans } from "./freshness.js";
import { moduleSource } from "./module-source.js";
import {
  moduleNames,
  type NeighbourRow,
  usedByOf,
  usesOf,
} from "./neighbours.js";
import {
  type LineStatus,
  lineStatus,
  type Responsibilities,
  type ResponsibilityEntry,
  validateResponsibilities,
} from "./responsibilities.js";
import type { Scan, ScanMember } from "./scan.js";

export interface DescribeRequest {
  module: string;
  kind: "module" | "package" | "interface";
  files: string[];
  source: string;
  members: ScanMember[];
  uses: NeighbourRow[];
  used_by: NeighbourRow[];
}

const OPTIONS = {
  all: { type: "boolean" },
  check: { type: "boolean" },
  repository: { type: "string" },
  json: { type: "boolean" },
} as const;

export const DESCRIBE_FLAGS = Object.keys(OPTIONS).map((name) => `--${name}`);

const USAGE =
  "recognizer describe [<module>... | --all | --check [<module>...]] [--repository <dir>] [--json]";

type Describer = { command: string[]; version: string };

interface Subject {
  id: string;
  hash: string | null;
  files: string[];
  source: string;
  status: LineStatus | { status: "unreadable" };
}

function responsibilitiesFile(root: string): string {
  return join(root, ".recognizer", "responsibilities.json");
}

function readResponsibilities(io: Io, root: string): Responsibilities {
  const file = responsibilitiesFile(root);

  if (!io.exists(file)) {
    return { schema_version: 1, modules: {} };
  }

  try {
    return validateResponsibilities(JSON.parse(io.readFile(file)));
  } catch (error) {
    if (error instanceof InputError) {
      throw error;
    }

    throw new InputError([
      `responsibilities is not valid JSON: ${(error as Error).message}`,
    ]);
  }
}

function serialise(modules: Record<string, ResponsibilityEntry>): string {
  const sorted: Record<string, ResponsibilityEntry> = {};

  for (const id of Object.keys(modules).sort()) {
    const entry = modules[id] as ResponsibilityEntry;

    sorted[id] = {
      line: entry.line,
      source_hash: entry.source_hash,
      describer: entry.describer,
      version: entry.version,
    };
  }

  return `${JSON.stringify({ schema_version: 1, modules: sorted }, null, 2)}\n`;
}

function writeResponsibilities(
  io: Io,
  root: string,
  modules: Record<string, ResponsibilityEntry>,
): void {
  const file = responsibilitiesFile(root);
  const temp = `${file}.tmp`;

  io.writeFile(temp, serialise(modules));
  io.rename(temp, file);
}

function subjectFor(
  io: Io,
  root: string,
  scans: Scan[],
  id: string,
  entries: Record<string, ResponsibilityEntry>,
  describer: Describer,
): Subject {
  const found = moduleSource(io, root, scans, id);

  if (found === null) {
    return {
      id,
      hash: null,
      files: [],
      source: "",
      status: { status: "unreadable" },
    };
  }

  return {
    id,
    hash: found.hash,
    files: found.files,
    source: found.source,
    status: lineStatus(
      entries[id],
      found.hash,
      describer.command,
      describer.version,
    ),
  };
}

function find(scans: Scan[], id: string) {
  for (const scan of scans) {
    const found = scan.modules.find((module) => module.id === id);

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function fill(
  item: string,
  root: string,
  module: string,
  request: string,
): string {
  return item
    .split("{repository}")
    .join(root)
    .split("{module}")
    .join(module)
    .split("{request}")
    .join(request);
}

function failureReason(
  result: ReturnType<Io["run"]>,
  program: string,
): string | null {
  const stderr = result.stderr.trim();

  if (!result.started) {
    return stderr !== "" ? stderr : `describer did not start: ${program}`;
  }

  if (result.status !== 0) {
    return stderr !== ""
      ? stderr
      : `describer exited with status ${result.status}`;
  }

  const output = result.stdout.trim();

  if (output === "") {
    return stderr !== "" ? stderr : "describer printed nothing";
  }

  if (/[\r\n]/.test(output)) {
    return "describer printed more than one line";
  }

  return null;
}

interface Loaded {
  root: string;
  json: boolean;
  scans: Scan[];
  modules: string[];
  describer: Describer;
  entries: Record<string, ResponsibilityEntry>;
  names: string[];
  all: boolean;
  check: boolean;
}

function load(argv: string[], io: Io): Loaded {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: OPTIONS,
  });

  if (values.all === true && positionals.length > 0) {
    throw new InputError([`--all takes no module; usage: ${USAGE}`]);
  }

  if (values.all === true && values.check === true) {
    throw new InputError([`--check cannot be combined with --all`]);
  }

  const root = resolve(values.repository ?? ".");
  const { scans } = freshScans(io, root);
  const describer = readConfig(io, root)?.describer;

  if (describer === undefined) {
    throw new InputError([
      "no describer is registered: add one to .recognizer/config.yaml",
    ]);
  }

  const entries = readResponsibilities(io, root).modules;
  const modules = moduleNames(scans);
  const unknown = positionals.filter((name) => !modules.includes(name));

  if (unknown.length > 0) {
    throw new InputError(unknown.map((name) => `no such module: ${name}`));
  }

  return {
    root,
    json: values.json === true,
    scans,
    modules,
    describer,
    entries,
    names: positionals,
    all: values.all === true,
    check: values.check === true,
  };
}

function runCheck(loaded: Loaded, io: Io): number {
  const { root, describer, entries, names } = loaded;
  const ids = (names.length > 0 ? names : loaded.modules).slice().sort();
  const subjects = ids.map((id) =>
    subjectFor(io, root, loaded.scans, id, entries, describer),
  );
  const gone =
    names.length > 0
      ? []
      : Object.keys(entries)
          .filter((id) => !loaded.modules.includes(id))
          .sort();
  const counts = { current: 0, outOfDate: 0, missing: 0, unreadable: 0 };

  const rows = subjects.map((subject) => {
    const status = subject.status.status;

    if (status === "current") {
      counts.current += 1;
    } else if (status === "out-of-date") {
      counts.outOfDate += 1;
    } else if (status === "missing") {
      counts.missing += 1;
    } else {
      counts.unreadable += 1;
    }

    return {
      module: subject.id,
      status,
      line: entries[subject.id]?.line ?? null,
      reasons:
        subject.status.status === "out-of-date" ? subject.status.reasons : [],
    };
  });
  const ok = rows.every((row) => row.status === "current");

  if (loaded.json) {
    io.stdout(
      `${JSON.stringify({ ok, counts, modules: rows, gone }, null, 2)}\n`,
    );

    return ok ? 0 : 1;
  }

  const lines = rows.map((row) => {
    const reasons =
      row.reasons.length > 0
        ? ` ${row.reasons.map((reason) => `(${reason} changed)`).join(" ")}`
        : "";

    return `${row.module}  ${row.status}  ${row.line ?? ""}${reasons}`.trimEnd();
  });
  const unreadable =
    counts.unreadable > 0 ? `, ${counts.unreadable} unreadable` : "";

  lines.push(
    `${counts.current} current, ${counts.outOfDate} out of date, ${counts.missing} missing${unreadable}`,
  );

  for (const id of gone) {
    lines.push(`gone ${id}`);
  }

  io.stdout(`${lines.join("\n")}\n`);

  return ok ? 0 : 1;
}

function buildRequest(loaded: Loaded, subject: Subject): DescribeRequest {
  const module = find(loaded.scans, subject.id);

  return {
    module: subject.id,
    kind: module?.kind ?? "module",
    files: subject.files,
    source: subject.source,
    members: module?.members ?? [],
    uses: usesOf(loaded.scans, loaded.modules, subject.id),
    used_by: usedByOf(loaded.scans, loaded.modules, subject.id),
  };
}

function runDescribe(loaded: Loaded, io: Io): number {
  const { root, describer, names } = loaded;
  const entries = { ...loaded.entries };
  const subjects = loaded.modules
    .slice()
    .sort()
    .map((id) => subjectFor(io, root, loaded.scans, id, entries, describer));
  const selected = subjects.filter((subject) => {
    if (loaded.all) {
      return true;
    }

    if (names.length > 0) {
      return names.includes(subject.id);
    }

    return (
      subject.status.status === "missing" ||
      subject.status.status === "out-of-date" ||
      subject.status.status === "unreadable"
    );
  });
  const described: string[] = [];
  const failed: { module: string; reason: string }[] = [];
  let temp: string | null = null;

  const fail = (module: string, reason: string) => {
    failed.push({ module, reason });
    io.stderr(`failed ${module}: ${reason}\n`);
  };

  try {
    for (const [index, subject] of selected.entries()) {
      if (subject.hash === null) {
        fail(subject.id, "source could not be read");

        continue;
      }

      temp ??= io.makeTempDir();

      const requestFile = join(temp, `request-${index}.json`);

      io.writeFile(
        requestFile,
        `${JSON.stringify(buildRequest(loaded, subject), null, 2)}\n`,
      );

      const [program, ...rest] = describer.command.map((item) =>
        fill(item, root, subject.id, requestFile),
      ) as [string, ...string[]];
      const result = io.run(program, rest);
      const reason = failureReason(result, program);

      if (reason !== null) {
        fail(subject.id, reason);

        continue;
      }

      entries[subject.id] = {
        line: result.stdout.trim(),
        source_hash: subject.hash,
        describer: describer.command,
        version: describer.version,
      };
      writeResponsibilities(io, root, entries);
      described.push(subject.id);
      if (!loaded.json) {
        io.stdout(`described ${subject.id}\n`);
      }
    }
  } finally {
    if (temp !== null) {
      io.removeDir(temp);
    }
  }

  const pruned = Object.keys(entries)
    .filter((id) => !loaded.modules.includes(id))
    .sort();

  for (const id of pruned) {
    delete entries[id];
  }

  if (pruned.length > 0) {
    writeResponsibilities(io, root, entries);
  }

  const selectedIds = new Set(selected.map((subject) => subject.id));
  const current = subjects.filter(
    (subject) =>
      !selectedIds.has(subject.id) && subject.status.status === "current",
  ).length;

  if (loaded.json) {
    io.stdout(
      `${JSON.stringify({ described, failed, current, pruned }, null, 2)}\n`,
    );
  } else {
    const prunedNote = pruned.length > 0 ? `, pruned ${pruned.length}` : "";

    io.stdout(
      `described ${described.length}, failed ${failed.length}, already current ${current}${prunedNote}\n`,
    );
  }

  return failed.length > 0 ? 1 : 0;
}

export function runDescribeCommand(argv: string[], io: Io): number {
  const loaded = load(argv, io);

  return loaded.check ? runCheck(loaded, io) : runDescribe(loaded, io);
}
