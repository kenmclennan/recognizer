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
  "       recognizer sensors check [name] [--run] [--json] [--repository <dir>]",
];

export function runSensors(argv: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean" },
      run: { type: "boolean" },
      repository: { type: "string" },
    },
  });
  const [verb, name, ...extra] = positionals;

  if (verb !== undefined && (verb !== "check" || extra.length > 0)) {
    throw new InputError(USAGE);
  }

  if (verb === undefined && (values.run === true || values.repository)) {
    throw new InputError(USAGE);
  }

  if (verb === "check") {
    const root = resolve(values.repository ?? ".");
    const reports = checkSensors(
      io,
      root,
      sensorsToCheck(io, root, name),
      values.run === true,
    );

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
