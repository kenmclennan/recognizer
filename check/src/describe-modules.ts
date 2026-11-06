import { join } from "node:path";
import type { Io, Running, RunResult } from "./cli.js";
import {
  type DescribeProjection,
  projectDescribe,
} from "./describe-projection.js";
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
  model: string,
): string {
  return item
    .split("{repository}")
    .join(root)
    .split("{model}")
    .join(model)
    .split("{module}")
    .join(module)
    .split("{request}")
    .join(request);
}

function failureReason(result: RunResult, program: string): string | null {
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
  | { kind: "stale"; within?: string[] }
  | { kind: "all"; within?: string[] }
  | { kind: "names"; names: string[] };

export const LIMIT_STATUS = 75;

export interface DescribeStop {
  cause: "limit" | "failures";
  module: string;
  reason: string;
  described: number;
  not_described: string[];
  threshold: number;
}

export interface DescribeResult {
  described: string[];
  failed: { module: string; reason: string }[];
  current: number;
  pruned: string[];
  stopped: DescribeStop | null;
}

export interface DescribeInput {
  io: Io;
  root: string;
  scans: Scan[];
  describer: Describer;
  selection: DescribeSelection;
  model: string;
  batchSize: number;
  onProjection?: (projection: DescribeProjection) => void;
  onStart?: (total: number) => void;
  onEntry?: (entry: RunEntry) => void;
}

export async function describeModules(
  input: DescribeInput,
): Promise<DescribeResult> {
  const { io, root, scans, describer, selection } = input;
  const entries = { ...readResponsibilities(io, root).modules };
  const modules = moduleNames(scans);
  const within = selection.kind === "names" ? undefined : selection.within;

  for (const id of within ?? []) {
    if (!modules.includes(id)) {
      io.stderr(`skipped: no such module ${id}\n`);
    }
  }

  const subjects = modules
    .slice()
    .sort()
    .filter((id) => within === undefined || within.includes(id))
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
  let stopped: DescribeStop | null = null;
  let failuresInARow = 0;
  const running = new Set<Running>();
  const threshold = Math.max(input.batchSize, 2);

  input.onProjection?.(
    projectDescribe(
      selected
        .filter((subject) => subject.hash !== null)
        .map((subject) => buildRequest(scans, modules, subject)),
      input.model,
    ),
  );

  input.onStart?.(selected.length);

  const fail = (module: string, reason: string) => {
    failed.push({ module, reason });
    io.stderr(`failed ${module}: ${reason}\n`);
  };

  const complete = (
    subject: Subject & { hash: string },
    filled: string[],
    began: number,
    result: RunResult,
  ) => {
    const reason = failureReason(result, filled[0] as string);

    if (stopped !== null && reason !== null) {
      return;
    }

    if (reason === null) {
      failuresInARow = 0;
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

      const limit = result.started && result.status === LIMIT_STATUS;

      failuresInARow += 1;

      if (limit || failuresInARow >= threshold) {
        stopped = {
          cause: limit ? "limit" : "failures",
          module: subject.id,
          reason,
          described: 0,
          not_described: [],
          threshold,
        };

        for (const other of running) {
          other.kill();
        }
      }
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
  };

  const launch = (subject: Subject & { hash: string }, index: number) => {
    temp ??= io.makeTempDir();

    const requestFile = join(temp, `request-${index}.json`);

    io.writeFile(
      requestFile,
      `${JSON.stringify(buildRequest(scans, modules, subject), null, 2)}\n`,
    );

    const filled = describer.command.map((item) =>
      fill(item, root, subject.id, requestFile, input.model),
    );
    const [program, ...rest] = filled as [string, ...string[]];
    const began = io.now();

    const call = io.runAsync(program, rest);

    running.add(call);

    return call.result.then((result) => {
      running.delete(call);
      complete(subject, filled, began, result);
    });
  };

  try {
    const queue = selected.entries();
    const lanes = Array.from(
      { length: Math.max(1, Math.min(input.batchSize, selected.length)) },
      async () => {
        for (const [index, subject] of queue) {
          if (stopped !== null) {
            return;
          }

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

          await launch({ ...subject, hash: subject.hash }, index);
        }
      },
    );

    await Promise.all(lanes);
  } finally {
    if (temp !== null) {
      io.removeDir(temp);
    }
  }

  described.sort();
  failed.sort((left, right) =>
    left.module < right.module ? -1 : left.module > right.module ? 1 : 0,
  );

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

  const stop = stopped as DescribeStop | null;

  if (stop !== null) {
    const failedIds = new Set(failed.map((one) => one.module));

    stop.described = described.length;
    stop.not_described = selected
      .map((subject) => subject.id)
      .filter((id) => !described.includes(id) && !failedIds.has(id))
      .sort();
  }

  return { described, failed, current, pruned, stopped: stop };
}

export function describeSummaryText(result: DescribeResult): string {
  const prunedNote =
    result.pruned.length > 0 ? `, pruned ${result.pruned.length}` : "";

  const stop = result.stopped;

  if (stop === null) {
    return `described ${result.described.length}, failed ${result.failed.length}, already current ${result.current}${prunedNote}\n`;
  }

  const cause = stopCauseText(stop);

  return `stopped: ${cause}; described ${result.described.length}, failed ${result.failed.length}, not described ${stop.not_described.length}, already current ${result.current}${prunedNote}\n`;
}

export function stopCauseText(stop: {
  cause: "limit" | "failures";
  reason: string;
  threshold: number;
}): string {
  return stop.cause === "limit"
    ? `claude usage limit reached (${stop.reason})`
    : `${stop.threshold} describer calls failed in a row (last: ${stop.reason})`;
}
