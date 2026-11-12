import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { configFile } from "./config.js";
import { detectLanguages } from "./detect.js";
import {
  buildReport,
  type DoctorFacts,
  reportJson,
  reportText,
} from "./doctor.js";
import { InputError } from "./errors.js";
import { cachedScansState } from "./freshness.js";

const USAGE = ["usage: recognizer doctor [REPOSITORY] [--json]"];

function readIfPresent(io: Io, file: string): string | null {
  return io.exists(file) ? io.readFile(file) : null;
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
  const root = resolve(given ?? ".");

  try {
    io.readDir(root);
  } catch {
    throw new InputError([`repository is not a directory: ${root}`]);
  }

  const languages = detectLanguages(io, root);
  const facts: DoctorFacts = {
    repository: root,
    named: given !== undefined,
    configText: readIfPresent(io, configFile(root)),
    policyText: readIfPresent(io, join(root, ".recognizer", "policy.yaml")),
    languages,
    scans: () => cachedScansState(io, root, languages),
  };
  const report = buildReport(facts);

  io.stdout(values.json === true ? reportJson(report) : reportText(report));

  return report.ok ? 0 : 1;
}
