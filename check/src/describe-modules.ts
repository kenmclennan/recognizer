import { join } from "node:path";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";
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
import { entryFrom, type RunEntry } from "./run-log.js";
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

export type Describer = { command: string[]; version: string };

export interface Subject {
  id: string;
  hash: string | null;
  files: string[];
  source: string;
  status: LineStatus | { status: "unreadable" };
}

function responsibilitiesFile(root: string): string {
  return join(root, ".recognizer", "responsibilities.json");
}

export function readResponsibilities(io: Io, root: string): Responsibilities {
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

export function subjectFor(
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

function buildRequest(
  scans: Scan[],
  modules: string[],
  subject: Subject,
): DescribeRequest {
  const module = find(scans, subject.id);

  return {
    module: subject.id,
    kind: module?.kind ?? "module",
    files: subject.files,
    source: subject.source,
    members: module?.members ?? [],
    uses: usesOf(scans, modules, subject.id),
    used_by: usedByOf(scans, modules, subject.id),
  };
}

export type DescribeSelection =
  | { kind: "stale" }
  | { kind: "all" }
  | { kind: "names"; names: string[] };

export interface DescribeResult {
  described: string[];
  failed: { module: string; reason: string }[];
  current: number;
  pruned: string[];
}

export interface DescribeInput {
  io: Io;
  root: string;
  scans: Scan[];
  describer: Describer;
  selection: DescribeSelection;
  onStart?: (total: number) => void;
  onEntry?: (entry: RunEntry) => void;
}

export function describeModules(input: DescribeInput): DescribeResult {
  const { io, root, scans, describer, selection } = input;
  const entries = { ...readResponsibilities(io, root).modules };
  const modules = moduleNames(scans);
  const subjects = modules
    .slice()
    .sort()
    .map((id) => subjectFor(io, root, scans, id, entries, describer));
  const selected = subjects.filter((subject) => {
    if (selection.kind === "all") {
      return true;
    }

    if (selection.kind === "names") {
      return selection.names.includes(subject.id);
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

  input.onStart?.(selected.length);

  const fail = (module: string, reason: string) => {
    failed.push({ module, reason });
    io.stderr(`failed ${module}: ${reason}\n`);
  };

  try {
    for (const [index, subject] of selected.entries()) {
      if (subject.hash === null) {
        fail(subject.id, "source could not be read");
        input.onEntry?.(
          entryFrom(subject.id, {
            command: [],
            status: null,
            stderr: "",
            duration_ms: 0,
            reason: "source could not be read",
          }),
        );

        continue;
      }

      temp ??= io.makeTempDir();

      const requestFile = join(temp, `request-${index}.json`);

      io.writeFile(
        requestFile,
        `${JSON.stringify(buildRequest(scans, modules, subject), null, 2)}\n`,
      );

      const filled = describer.command.map((item) =>
        fill(item, root, subject.id, requestFile),
      );
      const [program, ...rest] = filled as [string, ...string[]];
      const began = io.now();
      const result = io.run(program, rest);
      const reason = failureReason(result, program);

      if (reason === null) {
        entries[subject.id] = {
          line: result.stdout.trim(),
          source_hash: subject.hash,
          describer: describer.command,
          version: describer.version,
        };
        writeResponsibilities(io, root, entries);
        described.push(subject.id);
      } else {
        fail(subject.id, reason);
      }

      input.onEntry?.(
        entryFrom(subject.id, {
          command: filled,
          status: result.started ? result.status : null,
          stderr: result.stderr,
          duration_ms: io.now() - began,
          ...(reason === null ? {} : { reason }),
        }),
      );
    }
  } finally {
    if (temp !== null) {
      io.removeDir(temp);
    }
  }

  const pruned = Object.keys(entries)
    .filter((id) => !modules.includes(id))
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

  return { described, failed, current, pruned };
}

export function describeSummaryText(result: DescribeResult): string {
  const prunedNote =
    result.pruned.length > 0 ? `, pruned ${result.pruned.length}` : "";

  return `described ${result.described.length}, failed ${result.failed.length}, already current ${result.current}${prunedNote}\n`;
}
