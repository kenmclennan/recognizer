import { isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";
import { runAdd } from "./plugin-add.js";
import { pluginCheck, reportFailed, reportLines } from "./plugin-check.js";

const USAGE = [
  "usage: recognizer plugin check <command> [--repository <dir>] [--request <file>] [--json]",
  "       recognizer plugin add <name> [--kind sensor|describer] [--repository <dir>]",
];

function locate(io: Io, command: string): string | null {
  if (command.includes("/")) {
    const path = isAbsolute(command) ? command : resolve(command);

    return io.exists(path) ? path : null;
  }

  for (const directory of (io.env("PATH") ?? "").split(":")) {
    if (directory !== "" && io.exists(join(directory, command))) {
      return join(directory, command);
    }
  }

  return null;
}

async function runCheck(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean" },
      repository: { type: "string" },
      request: { type: "string" },
    },
  });
  const [command] = positionals;

  if (command === undefined || positionals.length > 1) {
    throw new InputError(USAGE);
  }

  const path = locate(io, command);

  if (path === null) {
    throw new InputError([`${command} was not found on PATH`]);
  }

  const report = await pluginCheck(io, path, undefined, {
    ...(values.repository === undefined
      ? {}
      : { repository: resolve(values.repository) }),
    ...(values.request === undefined
      ? {}
      : { request: resolve(values.request) }),
  });

  if (values.json === true) {
    io.stdout(
      `${JSON.stringify({ command: path, manifest: report.manifest, results: report.results })}\n`,
    );
  } else {
    io.stdout(`${reportLines(report).join("\n")}\n`);
  }

  return reportFailed(report) ? 1 : 0;
}

export function runPlugin(argv: string[], io: Io): number | Promise<number> {
  const [subcommand, ...rest] = argv;

  if (subcommand === "check") {
    return runCheck(rest, io);
  }

  if (subcommand === "add") {
    return runAdd(rest, io);
  }

  throw new InputError(USAGE);
}
