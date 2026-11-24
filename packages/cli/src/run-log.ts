import { basename, join } from "node:path";
import type { Diagnosis } from "@recognizer/core";
import { diagnosisDocumentOf } from "./adapters/filesystem/diagnosis-translator.js";
import type { DocumentDiagnosis } from "./adapters/filesystem/findings-document-types.js";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";
import { validateRunRecord } from "./log-document.js";

export type RunKind = "scan" | "sense" | "describe" | "measure" | "setup";

export interface RunEntry {
  name: string;
  command: string[];
  status: number | null;
  outcome: "ok" | "failed" | "stopped";
  duration_ms: number;
  reason?: string;
  diagnosis?: DocumentDiagnosis;
  stderr: string;
  stderr_truncated?: true;
  modules?: number;
  fixed_ms?: number;
  incomplete?: true;
  work?: EntryWork;
  suites?: EntrySuite[];
}

export interface EntrySuite {
  name: string;
  duration_ms: number;
}

export interface EntryWork {
  unit: string;
  performed: number;
}

export type PhaseName = "extract" | "describe" | "measure" | "sense";

export type RecordedPhaseName = PhaseName | "structure";

export interface RunPhase {
  phase: RecordedPhaseName;
  entries: RunEntry[];
  duration_ms?: number;
}

export interface SkippedPhase {
  phase: string;
  reason: string;
}

export interface RunRecord {
  log_version: 1;
  kind: RunKind;
  started: string;
  finished: string | null;
  by: string;
  arguments: string[];
  outcome: "ok" | "failed" | "running" | "stopped";
  exit: 0 | 1;
  entries?: RunEntry[];
  phases?: RunPhase[];
  skipped?: SkippedPhase[];
  structure_ms?: number;
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
  outcome: "ok" | "failed" | "running" | "stopped";
  entries: number;
  failed: number;
}

export interface EntryTiming {
  command: string[];
  status: number | null;
  stderr: string;
  duration_ms: number;
  reason?: string;
  stopped?: boolean;
  diagnosis?: Diagnosis;
  modules?: number;
  fixed_ms?: number;
  incomplete?: boolean;
  work?: EntryWork;
  suites?: EntrySuite[];
}

export const STDERR_LIMIT = 8192;
export const KEEP = 50;

const NAME = /^\d{8}T\d{9}Z-(scan|sense|describe|measure|setup)\.json$/;
const ID = /^\d{8}T\d{9}Z-(scan|sense|describe|measure)$/;
const BY_LIMIT = 64;
const RECYCLE_SLACK_MS = 5000;

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
    outcome: ok ? "ok" : timing.stopped === true ? "stopped" : "failed",
    duration_ms: timing.duration_ms,
    stderr,
  };

  if (timing.reason !== undefined) {
    entry.reason = timing.reason;
  }

  if (timing.diagnosis !== undefined) {
    entry.diagnosis = diagnosisDocumentOf(timing.diagnosis);
  }

  if (truncated) {
    entry.stderr_truncated = true;
  }

  if (timing.modules !== undefined) {
    entry.modules = timing.modules;
  }

  if (timing.fixed_ms !== undefined) {
    entry.fixed_ms = timing.fixed_ms;
  }

  if (timing.incomplete === true) {
    entry.incomplete = true;
  }

  if (timing.work !== undefined) {
    entry.work = timing.work;
  }

  if (timing.suites !== undefined && timing.suites.length > 0) {
    entry.suites = timing.suites;
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
  crashed = false,
): RunRecord {
  const failed = crashed || entries.some((entry) => entry.outcome === "failed");

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
  skipped: SkippedPhase[] = [],
  refused = false,
  structureMs?: number,
  stopped = false,
): RunRecord {
  const failed =
    refused ||
    phases.some((phase) =>
      phase.entries.some((entry) => entry.outcome === "failed"),
    );

  return {
    log_version: 1,
    kind: "scan",
    started: new Date(startedAt).toISOString(),
    finished: running ? null : new Date(io.now()).toISOString(),
    by: asker(io, by),
    arguments: argv,
    outcome: running
      ? "running"
      : stopped
        ? "stopped"
        : failed
          ? "failed"
          : "ok",
    exit: running ? 0 : stopped || failed ? 1 : 0,
    phases,
    ...(skipped.length === 0 ? {} : { skipped: [...skipped] }),
    ...(structureMs === undefined ? {} : { structure_ms: structureMs }),
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
  finish(entries: RunEntry[], crashed?: boolean): void;
}

export interface OpenPhasedRunLog {
  id(): string | null;
  skip(skipped: SkippedPhase): void;
  update(phases: RunPhase[]): void;
  finish(phases: RunPhase[], refused?: boolean, structureMs?: number): void;
  stop(phases: RunPhase[], structureMs?: number): void;
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
    phases.map((one) => ({
      phase: one.phase,
      entries: [...one.entries],
      ...(one.duration_ms === undefined
        ? {}
        : { duration_ms: one.duration_ms }),
    }));

  const skipped: SkippedPhase[] = [];

  write(buildPhasedRecord(io, startedAt, by, argv, [], true));

  return {
    id,
    skip: (one) => {
      skipped.push(one);
    },
    update: (phases) =>
      write(
        buildPhasedRecord(
          io,
          startedAt,
          by,
          argv,
          snapshot(phases),
          true,
          skipped,
        ),
      ),
    finish: (phases, refused = false, structureMs) =>
      write(
        buildPhasedRecord(
          io,
          startedAt,
          by,
          argv,
          snapshot(phases),
          false,
          skipped,
          refused,
          structureMs,
        ),
      ),
    stop: (phases, structureMs) =>
      write(
        buildPhasedRecord(
          io,
          startedAt,
          by,
          argv,
          snapshot(phases),
          false,
          skipped,
          false,
          structureMs,
          true,
        ),
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
    finish: (entries, crashed = false) =>
      write(buildRecord(io, kind, startedAt, by, argv, entries, crashed)),
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

export interface KilledRunDetails {
  runId: string;
  startedAt: string;
  startedBy: string;
  running: string[];
}

const KILLED_REASON = "the run was killed outright";

function stoppedEntry(name: string): RunEntry {
  return {
    name,
    command: [],
    status: null,
    outcome: "stopped",
    duration_ms: 0,
    reason: KILLED_REASON,
    stderr: "",
  };
}

function withStoppedEntries(phases: RunPhase[], names: string[]): RunPhase[] {
  const has = (phase: RunPhase, name: string) =>
    phase.entries.some((entry) => entry.name === name);
  const fresh = names.filter(
    (name) => !phases.some((phase) => has(phase, name)),
  );

  if (fresh.length === 0) {
    return phases;
  }

  const entries = fresh.map(stoppedEntry);
  const sense = phases.find((phase) => phase.phase === "sense");

  return sense === undefined
    ? [...phases, { phase: "sense", entries }]
    : phases.map((phase) =>
        phase === sense
          ? { ...phase, entries: [...phase.entries, ...entries] }
          : phase,
      );
}

function openScanRecord(
  io: Io,
  root: string,
  startedAt: string,
): { file: string; record: RunRecord } | null {
  const directory = logDirectory(root);
  const names = io
    .readDir(directory)
    .map((entry) => entry.name)
    .filter((name) => NAME.test(name) && name.endsWith("-scan.json"))
    .sort()
    .reverse();
  const earliest = Date.parse(startedAt) - RECYCLE_SLACK_MS;

  for (const name of names) {
    const file = join(directory, name);
    let record: RunRecord;

    try {
      record = validateRunRecord(JSON.parse(io.readFile(file)));
    } catch {
      continue;
    }

    if (Date.parse(record.started) < earliest) {
      return null;
    }

    if (
      record.kind === "scan" &&
      record.outcome === "running" &&
      record.finished === null
    ) {
      return { file, record };
    }
  }

  return null;
}

export function settleKilledRun(
  io: Io,
  root: string,
  killed: KilledRunDetails,
): void {
  let open: { file: string; record: RunRecord } | null = null;

  try {
    open = openScanRecord(io, root, killed.startedAt);
  } catch {
    open = null;
  }

  const finished = new Date(io.now()).toISOString();

  if (open !== null) {
    writeAtomic(io, open.file, {
      ...open.record,
      finished,
      outcome: "stopped",
      exit: 1,
      phases: withStoppedEntries(open.record.phases ?? [], killed.running),
    });

    return;
  }

  const record: RunRecord = {
    log_version: 1,
    kind: "scan",
    started: killed.startedAt,
    finished,
    by: asker(io, killed.startedBy),
    arguments: ["scan"],
    outcome: "stopped",
    exit: 1,
    phases: withStoppedEntries([], killed.running),
  };

  placeRunLog(io, root, record);
}
