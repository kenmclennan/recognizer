import { isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { configFile } from "./config.js";
import { detectLanguages } from "./detect.js";
import {
  buildReport,
  type DoctorFacts,
  reportJson,
  reportText,
  type ScannerAvailability,
} from "./doctor.js";
import { InputError } from "./errors.js";
import { cachedScansState } from "./freshness.js";
import type { ScannerSpec } from "./scanners.js";
import { checkSensor } from "./sensors-check.js";

const USAGE = ["usage: recognizer doctor [REPOSITORY] [--json]"];

function readIfPresent(io: Io, file: string): string | null {
  return io.exists(file) ? io.readFile(file) : null;
}

function scannerAvailability(io: Io, spec: ScannerSpec): ScannerAvailability {
  const override = io.env(spec.variable);

  if (override !== undefined && override !== "") {
    if (!isAbsolute(override)) {
      return {
        available: false,
        reason: "override",
        message: `${spec.variable} must be an absolute path: ${override}`,
      };
    }

    return io.exists(override)
      ? { available: true }
      : {
          available: false,
          reason: "missing",
          message: `${spec.variable} names ${override}, which does not exist`,
        };
  }

  const found = (io.env("PATH") ?? "")
    .split(":")
    .filter((directory) => directory !== "")
    .some((directory) => io.exists(join(directory, spec.name)));

  return found
    ? { available: true }
    : {
        available: false,
        reason: "missing",
        message: `${spec.name} is not installed: ${spec.language} files are present but no scanner is on PATH`,
      };
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
    scanner: (spec) => scannerAvailability(io, spec),
    sensorReports: (sensors) =>
      sensors.map((sensor) => checkSensor(io, root, sensor, {})),
  };
  const report = buildReport(facts);

  io.stdout(values.json === true ? reportJson(report) : reportText(report));

  return report.ok ? 0 : 1;
}
