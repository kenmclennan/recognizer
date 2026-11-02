import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";
import {
  latestRun,
  listRuns,
  type RunKind,
  type RunRecord,
  type RunSummary,
  readRun,
  STDERR_LIMIT,
} from "./run-log.js";

const USAGE =
  "recognizer log [<id>] [--last] [--kind scan|sense|describe|measure] [--repository <dir>] [--json]";

const KINDS = ["scan", "sense", "describe", "measure"];

function listLine(run: RunSummary): string {
  return `${run.id}  ${run.kind}  ${run.started}  ${run.outcome}  ${run.entries - run.failed} ok, ${run.failed} failed`;
}

function fullText(run: { id: string } & RunRecord): string {
  const lines = [
    `id: ${run.id}`,
    `kind: ${run.kind}`,
    `started: ${run.started}`,
    `finished: ${run.finished}`,
    `by: ${run.by}`,
    `arguments: ${run.arguments.join(" ")}`,
    `outcome: ${run.outcome} (exit ${run.exit})`,
  ];

  for (const entry of run.entries) {
    lines.push(
      "",
      `${entry.name}  ${entry.outcome}  exit ${entry.status ?? "none"}  ${entry.duration_ms}ms`,
      `  command: ${entry.command.join(" ")}`,
    );

    if (entry.reason !== undefined) {
      lines.push(`  reason: ${entry.reason}`);
    }

    if (entry.stderr !== "") {
      if (entry.stderr_truncated === true) {
        lines.push(`  (stderr cut to the last ${STDERR_LIMIT} characters)`);
      }

      for (const line of entry.stderr.split("\n")) {
        lines.push(`    ${line}`.trimEnd());
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

export function runLog(argv: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      last: { type: "boolean" },
      kind: { type: "string" },
      repository: { type: "string" },
      json: { type: "boolean" },
    },
  });
  const json = values.json === true;
  const root = resolve(values.repository ?? ".");
  const kind = values.kind;

  if (kind !== undefined && !KINDS.includes(kind)) {
    throw new InputError([`--kind must be one of ${KINDS.join(", ")}`]);
  }

  if (
    positionals.length > 1 ||
    (values.last === true && positionals.length > 0)
  ) {
    throw new InputError([`usage: ${USAGE}`]);
  }

  if (kind !== undefined && positionals.length > 0) {
    throw new InputError([
      `--kind cannot be combined with a run id; usage: ${USAGE}`,
    ]);
  }

  try {
    io.readDir(root);
  } catch {
    throw new InputError([`repository is not a directory: ${root}`]);
  }

  const print = (run: { id: string } & RunRecord) => {
    io.stdout(json ? `${JSON.stringify(run, null, 2)}\n` : fullText(run));

    return 0;
  };

  if (positionals[0] !== undefined) {
    return print(readRun(io, root, positionals[0]));
  }

  if (values.last === true) {
    const latest = latestRun(io, root, kind as RunKind | undefined);

    if (latest === null) {
      throw new InputError(["no runs recorded"]);
    }

    return print(latest);
  }

  const { runs, skipped } = listRuns(io, root, kind as RunKind | undefined);

  for (const one of skipped) {
    io.stderr(`skipped ${one.id}: ${one.message}\n`);
  }

  if (json) {
    io.stdout(`${JSON.stringify({ runs }, null, 2)}\n`);
  } else if (runs.length === 0) {
    io.stdout("no runs recorded\n");
  } else {
    io.stdout(`${runs.map(listLine).join("\n")}\n`);
  }

  return 0;
}
