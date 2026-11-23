import { join, posix } from "node:path";
import type { DoctorReport } from "@recognizer/core";
import { type Io, onStop } from "./cli.js";
import { doctorReport } from "./doctor-command.js";
import { buildRecord, entryFrom, type RunEntry, recordRun } from "./run-log.js";
import type { PlannedChange } from "./setup-changes.js";

export type ApplyEvent =
  | { event: "start"; total: number; commands: number }
  | {
      event: "command";
      index: number;
      step: number;
      steps: number;
      command: string;
      state: "running" | "done";
    }
  | { event: "doctor"; state: "running" | "done" }
  | {
      event: "change";
      index: number;
      state: "running" | "done" | "failed" | "undone";
      output: string;
    }
  | { event: "result"; ok: boolean; doctor: DoctorReport | null };

export type Snapshot = Map<string, string | null>;

const LOCKFILES = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
];

function filesUnder(io: Io, directory: string, into: string[]): void {
  let entries: ReturnType<Io["readDir"]>;

  try {
    entries = io.readDir(directory);
  } catch {
    return;
  }

  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = join(directory, entry.name);

    if (entry.kind === "directory") {
      if (
        !(posix.basename(directory) === ".recognizer" && entry.name === "cache")
      ) {
        filesUnder(io, path, into);
      }
    } else if (entry.kind === "file") {
      into.push(path);
    }
  }
}

function recognizerFiles(io: Io, root: string): string[] {
  const files: string[] = [];

  filesUnder(io, join(root, ".recognizer"), files);

  return files;
}

function npmPaths(changes: PlannedChange[]): string[] {
  const paths = new Set<string>();

  for (const change of changes) {
    for (const { argv, cwd } of change.steps) {
      if (argv[0] !== "npm") {
        continue;
      }

      paths.add(join(cwd, "package.json"));

      for (const name of LOCKFILES) {
        paths.add(join(cwd, name));
      }

      argv.forEach((word, at) => {
        if (word === "-w" || word === "--workspace") {
          const directory = argv[at + 1];

          if (directory !== undefined) {
            paths.add(join(cwd, directory, "package.json"));
          }
        }
      });
    }
  }

  return [...paths];
}

export function snapshotOf(
  io: Io,
  root: string,
  changes: PlannedChange[],
): Snapshot {
  const snapshot: Snapshot = new Map();

  for (const path of [...recognizerFiles(io, root), ...npmPaths(changes)]) {
    snapshot.set(
      path,
      io.exists(path) ? io.readBytes(path).toString("utf8") : null,
    );
  }

  return snapshot;
}

export function restore(io: Io, root: string, snapshot: Snapshot): void {
  for (const path of recognizerFiles(io, root)) {
    if (!snapshot.has(path)) {
      io.remove(path);
    }
  }

  for (const [path, content] of snapshot) {
    if (content === null) {
      if (io.exists(path)) {
        io.remove(path);
      }
    } else {
      io.writeFile(path, content);
    }
  }
}

export function cargoInstalled(change: PlannedChange): string | null {
  const install = change.steps.find(
    ({ argv }) => argv[0] === "cargo" && argv[1] === "install",
  );

  return install?.argv[2] ?? null;
}

export function undoNote(change: PlannedChange): string {
  const cargo = cargoInstalled(change);

  if (cargo !== null) {
    return `${cargo} was uninstalled`;
  }

  if (change.steps.some(({ argv }) => argv[0] === "npm")) {
    return "package.json and the lockfile are restored; the package stays in node_modules until the next npm install";
  }

  return "";
}

export interface Ran {
  ok: boolean;
  output: string;
  command: string[];
  status: number | null;
}

export async function runChange(
  io: Io,
  change: PlannedChange,
  stopped: () => boolean,
  onStep: (
    step: number,
    steps: number,
    argv: string[],
    state: "running" | "done",
  ) => void = () => {},
): Promise<Ran> {
  let output = "";
  let command: string[] = [];
  let status: number | null = 0;
  const steps = change.steps.length;

  for (const [at, { argv, cwd }] of change.steps.entries()) {
    if (stopped()) {
      return { ok: false, output: `${output}stopped\n`, command, status: 143 };
    }

    command = argv;

    const [program, ...args] = argv;

    onStep(at + 1, steps, argv, "running");

    const result = await io.runAsync(program as string, args, { cwd }).result;

    output += `${result.stdout}${result.stderr}`;
    status = result.status;

    if (!result.started) {
      return {
        ok: false,
        output: `${output}${program} could not be started\n`,
        command,
        status,
      };
    }

    if (result.stopped === true || result.status !== 0) {
      return {
        ok: false,
        output: result.stopped === true ? `${output}stopped\n` : output,
        command,
        status,
      };
    }

    onStep(at + 1, steps, argv, "done");
  }

  return { ok: true, output, command, status };
}

function entryOf(
  change: PlannedChange,
  ran: Ran,
  duration: number,
  reason: string | undefined,
): RunEntry {
  return entryFrom(change.id, {
    command:
      ran.command.length === 0 ? (change.steps[0]?.argv ?? []) : ran.command,
    status: ran.status,
    duration_ms: duration,
    stderr: ran.output,
    ...(reason === undefined ? {} : { reason }),
  });
}

export async function applyChanges(
  io: Io,
  root: string,
  changes: PlannedChange[],
  emit: (event: ApplyEvent) => void,
  argv: string[] = [],
): Promise<boolean> {
  const startedAt = io.now();
  const snapshot = snapshotOf(io, root, changes);
  let stopRequested = false;
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const off = onStop(() => {
    stopRequested = true;

    return done;
  });
  const entries: RunEntry[] = [];
  const completed: { change: PlannedChange; index: number }[] = [];

  try {
    emit({
      event: "start",
      total: changes.length,
      commands: changes.reduce((sum, change) => sum + change.steps.length, 0),
    });

    for (const [index, change] of changes.entries()) {
      emit({ event: "change", index, state: "running", output: "" });

      const began = io.now();
      const ran = await runChange(
        io,
        change,
        () => stopRequested,
        (step, steps, stepArgv, state) =>
          emit({
            event: "command",
            index,
            step,
            steps,
            command: stepArgv.join(" "),
            state,
          }),
      );

      if (ran.ok) {
        completed.push({ change, index });
        entries.push(entryOf(change, ran, io.now() - began, undefined));
        emit({ event: "change", index, state: "done", output: ran.output });

        continue;
      }

      entries.push(
        entryOf(change, ran, io.now() - began, `${change.id} failed`),
      );
      emit({ event: "change", index, state: "failed", output: ran.output });
      restore(io, root, snapshot);

      for (const { change: earlier, index: at } of [...completed].reverse()) {
        const cargo = cargoInstalled(earlier);

        if (cargo !== null) {
          io.run("cargo", ["uninstall", cargo], { cwd: root });
        }

        emit({
          event: "change",
          index: at,
          state: "undone",
          output: undoNote(earlier),
        });
      }

      recordRun(
        io,
        root,
        buildRecord(io, "setup", startedAt, undefined, argv, entries),
      );
      emit({ event: "result", ok: false, doctor: null });

      return false;
    }

    let doctor: DoctorReport | null = null;

    emit({ event: "doctor", state: "running" });

    try {
      doctor = doctorReport(io, root, false);
    } catch {
      doctor = null;
    }

    emit({ event: "doctor", state: "done" });

    recordRun(
      io,
      root,
      buildRecord(io, "setup", startedAt, undefined, argv, entries),
    );
    emit({ event: "result", ok: true, doctor });

    return true;
  } finally {
    finish();
    off();
  }
}
