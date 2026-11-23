import { isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  pluginCheck,
  type Registrable,
  registerPlugin,
  scaffoldPlugin,
} from "@recognizer/core";
import type { Io } from "./cli.js";
import { asInputError, InputError } from "./errors.js";
import { reportFailed, reportLines } from "./plugin-check.js";
import { runSchema } from "./plugin-schema.js";
import { pluginPorts } from "./plugins-container.js";

const USAGE = [
  "usage: recognizer plugin check <command> [--repository <dir>] [--request <file>] [--json]",
  "       recognizer plugin add <name> [--kind sensor|describer] [--repository <dir>]",
  "       recognizer plugin init --kind <scanner|sensor|describer> --language <python|typescript|rust> --name <name> [folder]",
  "       recognizer plugin schema <manifest|events|scan|findings|overlay|check>",
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

  const report = await pluginCheck(pluginPorts(io), path, undefined, {
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

const ADD_USAGE = [
  "usage: recognizer plugin add <name> [--kind sensor|describer] [--repository <dir>]",
];

function runAdd(argv: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: { kind: { type: "string" }, repository: { type: "string" } },
  });
  const [name] = positionals;

  if (
    name === undefined ||
    positionals.length > 1 ||
    (values.kind !== undefined &&
      values.kind !== "sensor" &&
      values.kind !== "describer")
  ) {
    throw new InputError(ADD_USAGE);
  }

  const result = asInputError(() =>
    registerPlugin(pluginPorts(io), {
      name,
      kind: values.kind as Registrable | undefined,
      root: resolve(values.repository ?? "."),
    }),
  );

  if (result.status === "failed") {
    io.stderr(`recognizer plugin add: ${result.message}\n`);

    return 1;
  }

  for (const warning of result.warnings) {
    io.stderr(`recognizer plugin add: ${warning}\n`);
  }

  io.stdout(`${result.line}\n`);

  return 0;
}

function runInit(argv: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      kind: { type: "string" },
      language: { type: "string" },
      name: { type: "string" },
    },
  });

  if (positionals.length > 1) {
    throw new InputError([
      "only one folder may be given",
      "usage: recognizer plugin init --kind <scanner|sensor|describer> --language <python|typescript|rust> --name <name> [folder]",
      "example: recognizer plugin init --kind scanner --language python --name mylang ./recognizer-scan-mylang",
    ]);
  }

  const result = asInputError(() =>
    scaffoldPlugin(pluginPorts(io), {
      kind: values.kind,
      language: values.language,
      name: values.name,
      folder: resolve(positionals[0] ?? "."),
    }),
  );

  if (result.status === "failed") {
    io.stderr(`recognizer plugin init: ${result.message}\n`);

    return 1;
  }

  io.stdout(result.text);

  return 0;
}

export function runPlugin(argv: string[], io: Io): number | Promise<number> {
  const [subcommand, ...rest] = argv;

  if (subcommand === "check") {
    return runCheck(rest, io);
  }

  if (subcommand === "add") {
    return runAdd(rest, io);
  }

  if (subcommand === "init") {
    return runInit(rest, io);
  }

  if (subcommand === "schema") {
    return runSchema(rest, io);
  }

  throw new InputError(USAGE);
}
