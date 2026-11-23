import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { reportFindingsFresh } from "@recognizer/core";
import type { Io } from "./cli.js";
import { asInputError, InputError } from "./errors.js";
import { findingsFile } from "./findings-files.js";
import { freshPorts } from "./fresh-ports.js";
import { requestFrom } from "./scan-main.js";

const OPTIONS = {
  as: { type: "string" },
  repository: { type: "string" },
  json: { type: "boolean" },
} as const;

export const REPORT_FLAGS = Object.keys(OPTIONS).map((name) => `--${name}`);

function readSource(io: Io, file: string | undefined): string {
  if (file === undefined) {
    return io.readStdin();
  }

  try {
    return io.readFile(file);
  } catch {
    throw new InputError([`cannot read findings file: ${file}`]);
  }
}

export function runReport(argv: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: OPTIONS,
  });

  if (positionals.length > 1) {
    throw new InputError(["report takes at most one findings file"]);
  }

  const root = resolve(values.repository ?? ".");
  const outcome = asInputError(() =>
    reportFindingsFresh(freshPorts(io, ["sensors"]), {
      root,
      as: values.as,
      findingsText: () => readSource(io, positionals[0]),
      scan: requestFrom([root, "--extract"], io).request,
    }),
  );

  if (!outcome.ok) {
    io.stderr(`${outcome.message}\n`);

    return 1;
  }

  const { name, commit, document } = outcome;

  if (values.json === true) {
    io.stdout(
      `${JSON.stringify(
        {
          path: findingsFile(root, name),
          commit,
          findings: document.findings.length,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    io.stdout(
      `reported ${name}: ${document.findings.length} findings at ${commit.slice(0, 7)}\n`,
    );
  }

  return 0;
}
