import { basename, join } from "node:path";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";
import { validateRunRecord } from "./log-document.js";
import type { Diagnosis } from "./sensor-reason.js";

export type RunKind = "scan" | "sense" | "describe" | "measure";

export interface RunEntry {
  name: string;
  command: string[];
  status: number | null;
  outcome: "ok" | "failed";
  duration_ms: number;
  reason?: string;
  diagnosis?: Diagnosis;
  stderr: string;
  stderr_truncated?: true;
}

export type PhaseName = "extract" | "describe" | "measure" | "sense";

export interface RunPhase {
  phase: PhaseName;
  entries: RunEntry[];
}

export interface RunRecord {
  log_version: 1;
  kind: RunKind;
  started: string;
  finished: string | null;
  by: string;
  arguments: string[];
  outcome: "ok" | "failed" | "running";
  exit: 0 | 1;
  entries?: RunEntry[];
  phases?: RunPhase[];
}

export function entriesOf(record: RunRecord): RunEntry[] {
  return (
    record.phases?.flatMap((phase) => phase.entries) ?? record.entries ?? []
  );
}

export interface RunSummary {
  id: string;
  kind: RunKind;
  started: string;
  finished: string | null;
  by: string;
  outcome: "ok" | "failed" | "running";
  entries: number;
  failed: number;
}

export interface EntryTiming {
  command: string[];
  status: number | null;
  stderr: string;
  duration_ms: number;
  reason?: string;
  diagnosis?: Diagnosis;
}

export const STDERR_LIMIT = 8192;
export const KEEP = 50;

const NAME = /^\d{8}T\d{9}Z-(scan|sense|describe|measure)\.json$/;
const ID = /^\d{8}T\d{9}Z-(scan|sense|describe|measure)$/;
const BY_LIMIT = 64;

export function logDirectory(root: string): string {
  return join(root, ".recognizer", "cache", "log");
}

export function bound(stderr: string): { stderr: string; truncated: boolean } {
  const trimmed = stderr.trimEnd();

  return trimmed.length > STDERR_LIMIT
    ? { stderr: trimmed.slice(trimmed.length - STDERR_LIMIT), truncated: true }
    : { stderr: trimmed, truncated: false };
}

export function asker(io: Io, by: string | undefined): string {
  if (by !== undefined) {
    return by.trim().slice(0, BY_LIMIT);
  }

  const user = io.env("USER");
  const login = io.env("LOGNAME");

  return user !== undefined && user !== ""
    ? user
    : login !== undefined && login !== ""
      ? login
      : "unknown";
}

export function requireBy(by: string | undefined): void {
  if (by !== undefined && by.trim() === "") {
    throw new InputError(["--by needs a name"]);
  }
}

export function entryFrom(name: string, timing: EntryTiming): RunEntry {
  const { stderr, truncated } = bound(timing.stderr);
  const ok = timing.reason === undefined;
  const entry: RunEntry = {
    name,
    command: timing.command,
    status: timing.status,
    outcome: ok ? "ok" : "failed",
    duration_ms: timing.duration_ms,
    stderr,
  };

  if (timing.reason !== undefined) {
    entry.reason = timing.reason;
  }

  if (timing.diagnosis !== undefined) {
    entry.diagnosis = timing.diagnosis;
  }

  if (truncated) {
    entry.stderr_truncated = true;
  }

  return entry;
}

export function buildRecord(
  io: Io,
  kind: RunKind,
  startedAt: number,
  by: string | undefined,
  argv: string[],
  entries: RunEntry[],
): RunRecord {
  const failed = entries.some((entry) => entry.outcome === "failed");

  return {
    log_version: 1,
    kind,
    started: new Date(startedAt).toISOString(),
    finished: new Date(io.now()).toISOString(),
    by: asker(io, by),
    arguments: argv,
    outcome: failed ? "failed" : "ok",
    exit: failed ? 1 : 0,
    entries,
  };
}

export function buildPhasedRecord(
  io: Io,
  startedAt: number,
  by: string | undefined,
  argv: string[],
  phases: RunPhase[],
  running: boolean,
): RunRecord {
  const failed = phases.some((phase) =>
    phase.entries.some((entry) => entry.outcome === "failed"),
  );

  return {
    log_version: 1,
    kind: "scan",
    started: new Date(startedAt).toISOString(),
    finished: running ? null : new Date(io.now()).toISOString(),
    by: asker(io, by),
    arguments: argv,
    outcome: running ? "running" : failed ? "failed" : "ok",
    exit: running ? 0 : failed ? 1 : 0,
    phases,
  };
}

export function buildRunningRecord(
  io: Io,
  kind: RunKind,
  startedAt: number,
  by: string | undefined,
  argv: string[],
  entries: RunEntry[],
): RunRecord {
  return {
    log_version: 1,
    kind,
    started: new Date(startedAt).toISOString(),
    finished: null,
    by: asker(io, by),
    arguments: argv,
    outcome: "running",
    exit: 0,
    entries,
  };
}

function stamp(startedAt: string): number {
  return Date.parse(startedAt);
}

function nameFor(epoch: number, kind: RunKind): string {
  const text = new Date(epoch)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(".", "");

  return `${text}-${kind}`;
}

function placeRunLog(io: Io, root: string, record: RunRecord): string {
  const directory = logDirectory(root);
  let existing: Set<string>;

  try {
    existing = new Set(io.readDir(directory).map((entry) => entry.name));
  } catch {
    existing = new Set();
  }

  let epoch = stamp(record.started);

  while (existing.has(`${nameFor(epoch, record.kind)}.json`)) {
    epoch += 1;
  }

  const file = join(directory, `${nameFor(epoch, record.kind)}.json`);

  writeAtomic(io, file, record);

  const names = [...existing, `${nameFor(epoch, record.kind)}.json`]
    .filter((name) => NAME.test(name))
    .sort();

  for (const name of names.slice(0, Math.max(0, names.length - KEEP))) {
    io.remove(join(directory, name));
  }

  return file;
}

function writeAtomic(io: Io, file: string, record: RunRecord): void {
  const temp = `${file}.tmp`;

  io.writeFile(temp, `${JSON.stringify(record, null, 2)}\n`);
  io.rename(temp, file);
}

export function writeRunLog(
  io: Io,
  root: string,
  record: RunRecord,
): string | null {
  try {
    placeRunLog(io, root, record);

    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

export interface OpenRunLog {
  update(entries: RunEntry[]): void;
  finish(entries: RunEntry[]): void;
}

export interface OpenPhasedRunLog {
  id(): string | null;
  update(phases: RunPhase[]): void;
  finish(phases: RunPhase[]): void;
}

function openWriter(
  io: Io,
  root: string,
): { write: (record: RunRecord) => void; id: () => string | null } {
  let file: string | null = null;
  let reported = false;

  const write = (record: RunRecord) => {
    try {
      if (file === null) {
        file = placeRunLog(io, root, record);
      } else {
        writeAtomic(io, file, record);
      }
    } catch (error) {
      if (!reported) {
        reported = true;
        io.stderr(`could not write run log: ${(error as Error).message}\n`);
      }
    }
  };

  return {
    write,
    id: () => (file === null ? null : basename(file, ".json")),
  };
}

export function openPhasedRunLog(
  io: Io,
  root: string,
  startedAt: number,
  by: string | undefined,
  argv: string[],
): OpenPhasedRunLog {
  const { write, id } = openWriter(io, root);
  const snapshot = (phases: RunPhase[]): RunPhase[] =>
    phases.map((one) => ({ phase: one.phase, entries: [...one.entries] }));

  write(buildPhasedRecord(io, startedAt, by, argv, [], true));

  return {
    id,
    update: (phases) =>
      write(buildPhasedRecord(io, startedAt, by, argv, snapshot(phases), true)),
    finish: (phases) =>
      write(
        buildPhasedRecord(io, startedAt, by, argv, snapshot(phases), false),
      ),
  };
}

export function openRunLog(
  io: Io,
  root: string,
  kind: RunKind,
  startedAt: number,
  by: string | undefined,
  argv: string[],
): OpenRunLog {
  const { write } = openWriter(io, root);

  write(buildRunningRecord(io, kind, startedAt, by, argv, []));

  return {
    update: (entries) =>
      write(buildRunningRecord(io, kind, startedAt, by, argv, [...entries])),
    finish: (entries) =>
      write(buildRecord(io, kind, startedAt, by, argv, entries)),
  };
}

export function recordRun(io: Io, root: string, record: RunRecord): void {
  const problem = writeRunLog(io, root, record);

  if (problem !== null) {
    io.stderr(`could not write run log: ${problem}\n`);
  }
}

function summarise(id: string, record: RunRecord): RunSummary {
  return {
    id,
    kind: record.kind,
    started: record.started,
    finished: record.finished,
    by: record.by,
    outcome: record.outcome,
    entries: entriesOf(record).length,
    failed: entriesOf(record).filter((entry) => entry.outcome === "failed")
      .length,
  };
}

export function listRuns(
  io: Io,
  root: string,
  kind?: RunKind,
): { runs: RunSummary[]; skipped: { id: string; message: string }[] } {
  let names: string[];

  try {
    names = io
      .readDir(logDirectory(root))
      .map((entry) => entry.name)
      .filter((name) => NAME.test(name))
      .sort()
      .reverse();
  } catch {
    names = [];
  }

  const runs: RunSummary[] = [];
  const skipped: { id: string; message: string }[] = [];

  for (const name of names) {
    const id = name.slice(0, -".json".length);

    if (kind !== undefined && !id.endsWith(`-${kind}`)) {
      continue;
    }

    try {
      const record = validateRunRecord(
        JSON.parse(io.readFile(join(logDirectory(root), name))),
      );

      runs.push(summarise(id, record));
    } catch (error) {
      skipped.push({ id, message: (error as Error).message });
    }
  }

  return { runs, skipped };
}

export function readRun(
  io: Io,
  root: string,
  id: string,
): { id: string } & RunRecord {
  if (!ID.test(id)) {
    throw new InputError([`not a run id: ${id}`]);
  }

  const file = join(logDirectory(root), `${id}.json`);

  if (!io.exists(file)) {
    throw new InputError([`no such run: ${id}`]);
  }

  try {
    return { id, ...validateRunRecord(JSON.parse(io.readFile(file))) };
  } catch (error) {
    throw new InputError([
      `run ${id} is not valid: ${(error as Error).message}`,
    ]);
  }
}

export function latestRun(
  io: Io,
  root: string,
  kind?: RunKind,
): ({ id: string } & RunRecord) | null {
  const { runs } = listRuns(io, root, kind);
  const newest = runs[0];

  return newest === undefined ? null : readRun(io, root, newest.id);
}
