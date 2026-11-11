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
import { SHIPPED_SENSOR_LIST } from "./shipped-sensors.js";

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

  if (values.json === true) {
    io.stdout(`${JSON.stringify(SHIPPED_SENSOR_LIST, null, 2)}\n`);

    return 0;
  }

  io.stdout(
    `${SHIPPED_SENSOR_LIST.map(({ name, line }) => `${name}  ${line}`).join("\n")}\n`,
  );

  return 0;
}
