import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type {
  DescribeProjection,
  DescriberRef,
  Repository,
} from "@recognizer/core";
import { readDescribing } from "./app-settings.js";
import type { Io } from "./cli.js";
import { describeSummaryText, projectionText } from "./describe-projection.js";
import { describingFor } from "./describing-container.js";
import { InputError } from "./errors.js";
import { freshScans } from "./freshness.js";
import { requireBy } from "./run-log.js";

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
  repository: Repository;
  describer: DescriberRef;
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
    throw new InputError([`--all takes no file; usage: ${USAGE}`]);
  }

  if (values.all === true && values.check === true) {
    throw new InputError([`--check cannot be combined with --all`]);
  }

  requireBy(values.by);

  const root = resolve(values.repository ?? ".");
  const { repository } = freshScans(io, root, ["describer"]);
  const found = describingFor(io).readDescriber(root);

  return {
    root,
    json: values.json === true,
    repository,
    describer: {
      describerRef: true,
      command: found.command,
      version: found.version,
    },
    names: positionals,
    all: values.all === true,
    check: values.check === true,
    by: values.by,
    argv,
  };
}

function runCheck(loaded: Loaded, io: Io): number {
  const {
    ok,
    counts,
    modules: rows,
    gone,
  } = describingFor(io).checkDescriptions({
    root: loaded.root,
    repository: loaded.repository,
    describer: loaded.describer,
    names: loaded.names,
  });

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
  let projection: DescribeProjection | null = null;

  const { model, batch_size: batchSize } = readDescribing(io);

  const result = await describingFor(io).describeRecorded({
    root: loaded.root,
    model,
    batchSize,
    repository: loaded.repository,
    describer: loaded.describer,
    selection: loaded.all
      ? { kind: "all" }
      : loaded.names.length > 0
        ? { kind: "names", names: loaded.names }
        : { kind: "stale" },
    by: loaded.by,
    invocation: loaded.argv,
    say: (stream, text) =>
      stream === "stdout" ? io.stdout(text) : io.stderr(text),
    onProjection: (one) => {
      projection = one;

      if (!loaded.json) {
        io.stdout(projectionText(one));
      }
    },
    onEntry: (entry) => {
      if (entry.outcome === "ok" && !loaded.json) {
        io.stdout(`described ${entry.name}\n`);
      }
    },
  });

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

  const found = describingFor(io).readDescriber(
    resolve(values.repository ?? "."),
  );

  if (values.json === true) {
    io.stdout(
      `${JSON.stringify({ command: found.command, version: found.version })}\n`,
    );
  } else {
    io.stdout(`${found.command.join(" ")}  ${found.version}\n`);
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
