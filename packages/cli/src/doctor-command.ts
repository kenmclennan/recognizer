import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type DoctorReport, diagnose } from "@recognizer/core";
import type { Io } from "./cli.js";
import { reportJson, reportText } from "./doctor.js";
import { asInputError, InputError } from "./errors.js";
import { pluginPorts } from "./plugins-container.js";

const USAGE = ["usage: recognizer doctor [REPOSITORY] [--json]"];

export function doctorReport(
  io: Io,
  root: string,
  named: boolean,
): DoctorReport {
  return asInputError(() => diagnose(pluginPorts(io), root, named));
}

export function runDoctor(argv: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: { json: { type: "boolean" } },
  });

  if (positionals.length > 1) {
    throw new InputError(USAGE);
  }

  const [given] = positionals;
  const report = doctorReport(io, resolve(given ?? "."), given !== undefined);

  io.stdout(values.json === true ? reportJson(report) : reportText(report));

  return report.ok ? 0 : 1;
}
