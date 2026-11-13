import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";
import {
  checkSensors,
  reportJson,
  reportText,
  sensorsToCheck,
} from "./sensors-check.js";
import { readShippedSensors } from "./shipped-sensors.js";

const USAGE = [
  "usage: recognizer sensors [--json]",
  "       recognizer sensors check [name] [--run] [--work] [--modules <file>] [--suites <file>] [--json] [--repository <dir>]",
];

function suitesText(io: Io, file: string): string {
  let text: string;

  try {
    text = io.readFile(resolve(file));
  } catch (error) {
    throw new InputError([
      `cannot read --suites file ${file}: ${(error as Error).message}`,
    ]);
  }

  try {
    const parsed: unknown = JSON.parse(text);

    if (
      !Array.isArray(parsed) ||
      parsed.some((name) => typeof name !== "string" || name === "")
    ) {
      throw new Error("not an array of suite names");
    }

    return JSON.stringify(parsed);
  } catch (error) {
    throw new InputError([
      `--suites file must be a JSON array of suite names: ${(error as Error).message}`,
    ]);
  }
}

export function runSensors(argv: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean" },
      run: { type: "boolean" },
      work: { type: "boolean" },
      modules: { type: "string" },
      suites: { type: "string" },
      repository: { type: "string" },
    },
  });
  const [verb, name, ...extra] = positionals;

  if (verb !== undefined && (verb !== "check" || extra.length > 0)) {
    throw new InputError(USAGE);
  }

  if (
    verb === undefined &&
    (values.run === true ||
      values.work === true ||
      values.modules !== undefined ||
      values.suites !== undefined ||
      values.repository)
  ) {
    throw new InputError(USAGE);
  }

  if (verb === "check") {
    const root = resolve(values.repository ?? ".");
    const reports = checkSensors(io, root, sensorsToCheck(io, root, name), {
      run: values.run === true,
      work: values.work === true,
      ...(values.modules === undefined
        ? {}
        : { modules: resolve(values.modules) }),
      ...(values.suites === undefined
        ? {}
        : { suites: suitesText(io, values.suites) }),
    });

    io.stdout(values.json === true ? reportJson(reports) : reportText(reports));

    return reports.every((report) => report.ready) ? 0 : 1;
  }

  const { sensors, unreadable } = readShippedSensors(io);

  if (values.json === true) {
    io.stdout(`${JSON.stringify(sensors, null, 2)}\n`);
  } else if (sensors.length > 0) {
    io.stdout(
      `${sensors
        .map(({ name, description }) => `${name}  ${description ?? ""}`)
        .join("\n")}\n`,
    );
  }

  for (const { name, reason } of unreadable) {
    io.stderr(`${name}: ${reason}\n`);
  }

  return unreadable.length === 0 ? 0 : 1;
}
