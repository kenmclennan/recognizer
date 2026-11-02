import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { readConfig } from "./config.js";
import type { OverlayRegistration } from "./config-parse.js";
import { InputError } from "./errors.js";
import { type Expected, validateOverlay } from "./overlays.js";
import { type RegisteredRun, runRegistered } from "./registered-command.js";
import {
  buildRecord,
  entryFrom,
  type RunEntry,
  recordRun,
  requireBy,
} from "./run-log.js";
import { isDirty, resolveCommit } from "./scan-command.js";

const OPTIONS = {
  repository: { type: "string" },
  json: { type: "boolean" },
  by: { type: "string" },
} as const;

export const MEASURE_FLAGS = Object.keys(OPTIONS).map((name) => `--${name}`);

function overlayFile(root: string, name: string): string {
  return join(root, ".recognizer", "cache", "overlays", `${name}.json`);
}

function measureOne(
  io: Io,
  root: string,
  name: string,
  command: string[],
  expected: Expected,
): RegisteredRun {
  return runRegistered(
    io,
    root,
    command,
    expected.commit,
    overlayFile(root, name),
    "overlay",
    (document) => {
      validateOverlay(document, expected);
    },
  );
}

export interface RunMeasurersInput {
  io: Io;
  root: string;
  selected: { name: string; registration: OverlayRegistration }[];
  commit: string;
  modified: boolean;
  onEntry?: (entry: RunEntry) => void;
}

export function runMeasurers(input: RunMeasurersInput): RunEntry[] {
  const { io, root, commit, modified } = input;
  const entries: RunEntry[] = [];

  for (const { name, registration } of input.selected) {
    const began = io.now();
    const run = measureOne(io, root, name, registration.command, {
      commit,
      modified,
      metrics: registration.metrics,
    });
    const { reason } = run;
    const entry = entryFrom(name, {
      command: run.command,
      status: run.status,
      stderr: run.stderr,
      duration_ms: io.now() - began,
      ...(reason === null ? {} : { reason }),
    });

    entries.push(entry);

    if (reason !== null) {
      io.remove(overlayFile(root, name));
      io.stderr(`failed ${name}: ${reason}\n`);
    }

    input.onEntry?.(entry);
  }

  return entries;
}

export function runMeasure(argv: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: OPTIONS,
  });
  requireBy(values.by);

  const startedAt = io.now();
  const root = resolve(values.repository ?? ".");
  const overlays = readConfig(io, root)?.overlays ?? {};
  const registered = Object.keys(overlays);

  if (registered.length === 0) {
    throw new InputError([
      "no overlays are registered: add one to .recognizer/config.yaml",
    ]);
  }

  const unknown = positionals.filter((name) => !registered.includes(name));

  if (unknown.length > 0) {
    throw new InputError(unknown.map((name) => `no such overlay: ${name}`));
  }

  const commit = resolveCommit(io, root);

  if (commit === null) {
    throw new InputError(["not a git repository, or no commit"]);
  }

  const modified = isDirty(io, root);
  const selected = positionals.length > 0 ? positionals : registered;
  const measured: string[] = [];
  const failed: { overlay: string; reason: string }[] = [];
  const entries = runMeasurers({
    io,
    root,
    commit,
    modified,
    selected: selected.map((name) => ({
      name,
      registration: overlays[name] as OverlayRegistration,
    })),
    onEntry: (entry) => {
      if (entry.outcome === "failed") {
        failed.push({ overlay: entry.name, reason: entry.reason as string });

        return;
      }

      measured.push(entry.name);

      if (values.json !== true) {
        io.stdout(`measured ${entry.name}\n`);
      }
    },
  });

  if (values.json === true) {
    io.stdout(
      `${JSON.stringify({ commit, modified, measured, failed }, null, 2)}\n`,
    );
  } else {
    io.stdout(`measured ${measured.length}, failed ${failed.length}\n`);
  }

  recordRun(
    io,
    root,
    buildRecord(io, "measure", startedAt, values.by, argv, entries),
  );

  return failed.length > 0 ? 1 : 0;
}
