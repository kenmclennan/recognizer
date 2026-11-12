import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { readDescribing } from "./app-settings.js";
import type { Io } from "./cli.js";
import {
  type Describer,
  describeModules,
  describeSummaryText,
  readResponsibilities,
  subjectFor,
} from "./describe-modules.js";
import {
  type DescribeProjection,
  projectionText,
} from "./describe-projection.js";
import { describerInEffect } from "./describer-in-effect.js";
import { InputError } from "./errors.js";
import { freshScans } from "./freshness.js";
import { moduleNames } from "./neighbours.js";
import type { ResponsibilityEntry } from "./responsibilities.js";
import {
  type OpenRunLog,
  openRunLog,
  type RunEntry,
  requireBy,
} from "./run-log.js";
import type { Scan } from "./scan.js";

const OPTIONS = {
  all: { type: "boolean" },
  check: { type: "boolean" },
  repository: { type: "string" },
  json: { type: "boolean" },
  by: { type: "string" },
  describer: { type: "boolean" },
} as const;

export const DESCRIBE_FLAGS = Object.keys(OPTIONS).map((name) => `--${name}`);

const USAGE =
  "recognizer describe [<module>... | --all | --check [<module>...]] [--repository <dir>] [--json]\n       recognizer describe --describer [--repository <dir>] [--json]";

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
  by: string | undefined;
  argv: string[];
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

  requireBy(values.by);

  const root = resolve(values.repository ?? ".");
  const { scans } = freshScans(io, root, ["describer"]);
  const { source: _source, ...describer } = describerInEffect(io, root);

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
    by: values.by,
    argv,
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

async function runDescribe(loaded: Loaded, io: Io): Promise<number> {
  const startedAt = io.now();
  const recorded: RunEntry[] = [];
  let runLog: OpenRunLog | null = null;
  let projection: DescribeProjection | null = null;

  const { model, batch_size: batchSize } = readDescribing(io);

  const result = await describeModules({
    io,
    root: loaded.root,
    model,
    batchSize,
    scans: loaded.scans,
    describer: loaded.describer,
    selection: loaded.all
      ? { kind: "all" }
      : loaded.names.length > 0
        ? { kind: "names", names: loaded.names }
        : { kind: "stale" },
    onProjection: (one) => {
      projection = one;

      if (!loaded.json) {
        io.stdout(projectionText(one));
      }
    },
    onStart: (total) => {
      if (total > 0) {
        runLog = openRunLog(
          io,
          loaded.root,
          "describe",
          startedAt,
          loaded.by,
          loaded.argv,
        );
      }
    },
    onEntry: (entry) => {
      recorded.push(entry);
      (runLog as OpenRunLog | null)?.update(recorded);

      if (entry.outcome === "ok" && !loaded.json) {
        io.stdout(`described ${entry.name}\n`);
      }
    },
  });

  (runLog as OpenRunLog | null)?.finish(recorded);

  if (loaded.json) {
    const { described, failed, current, pruned, stopped } = result;

    io.stdout(
      `${JSON.stringify(
        { projection, described, failed, current, pruned, stopped },
        null,
        2,
      )}\n`,
    );
  } else {
    io.stdout(describeSummaryText(result));
  }

  return result.failed.length > 0 || result.stopped !== null ? 1 : 0;
}

function runDescriber(argv: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: OPTIONS,
  });

  if (
    positionals.length > 0 ||
    values.all === true ||
    values.check === true ||
    values.by !== undefined
  ) {
    throw new InputError([
      `--describer takes no other option; usage: ${USAGE}`,
    ]);
  }

  const found = describerInEffect(io, resolve(values.repository ?? "."));

  if (values.json === true) {
    io.stdout(
      `${JSON.stringify({ command: found.command, version: found.version, source: found.source })}\n`,
    );
  } else {
    io.stdout(
      `${found.command.join(" ")}  ${found.version}  ${found.source}\n`,
    );
  }

  return 0;
}

export function runDescribeCommand(
  argv: string[],
  io: Io,
): number | Promise<number> {
  if (argv.includes("--describer")) {
    return runDescriber(argv, io);
  }

  const loaded = load(argv, io);

  return loaded.check ? runCheck(loaded, io) : runDescribe(loaded, io);
}
