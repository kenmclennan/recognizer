import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import {
  buildReport,
  type DoctorFacts,
  reportJson,
  reportText,
} from "./doctor.js";
import { InputError } from "./errors.js";

const USAGE = ["usage: recognizer doctor [REPOSITORY] [--json]"];

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

  const root = resolve(positionals[0] ?? ".");

  try {
    io.readDir(root);
  } catch {
    throw new InputError([`repository is not a directory: ${root}`]);
  }

  const facts: DoctorFacts = { repository: root };
  const report = buildReport(facts);

  io.stdout(values.json === true ? reportJson(report) : reportText(report));

  return report.ok ? 0 : 1;
}
