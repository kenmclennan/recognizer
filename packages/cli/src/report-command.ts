import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { readConfig } from "./config.js";
import { registeredSensors } from "./config-parse.js";
import { InputError } from "./errors.js";
import { validateFindings } from "./findings-document.js";
import { findingsFile, writeFindings } from "./findings-files.js";
import { freshScans } from "./freshness.js";
import { isDirty, resolveCommit } from "./scan-command.js";
import { shippedSensorNames } from "./shipped-sensors.js";
import { measuredInputs } from "./structure-sensor.js";

const OPTIONS = {
  as: { type: "string" },
  repository: { type: "string" },
  json: { type: "boolean" },
} as const;

export const REPORT_FLAGS = Object.keys(OPTIONS).map((name) => `--${name}`);

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

function requireName(io: Io, root: string, name: string | undefined): string {
  if (name === undefined) {
    throw new InputError(["report needs --as <name>"]);
  }

  if (!NAME_PATTERN.test(name) || name.length > 64) {
    throw new InputError([
      `--as ${name} is not a sensor name: lowercase letters, digits, - and _, at most 64`,
    ]);
  }

  const taken = [
    "structure",
    ...registeredSensors(readConfig(io, root, ["sensors"])).map(
      (sensor) => sensor.name,
    ),
    ...shippedSensorNames(),
  ];

  if (taken.includes(name)) {
    throw new InputError([
      `--as ${name} is a sensor the scan runs; a report needs a name of its own`,
    ]);
  }

  return name;
}

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

function ownVersion(document: unknown): string {
  const sensor = (document as { sensor?: { version?: unknown } } | null)
    ?.sensor;

  return typeof sensor?.version === "string" && sensor.version !== ""
    ? sensor.version
    : "reported";
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
  const name = requireName(io, root, values.as);
  const commit = resolveCommit(io, root);

  if (commit === null) {
    throw new InputError([
      "a report is stamped with the commit it was made at, and this folder has none",
    ]);
  }

  const text = readSource(io, positionals[0]);
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    io.stderr(`findings are not JSON: ${(error as Error).message}\n`);

    return 1;
  }

  const source =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const { findings } = source;
  const { scans } = freshScans(io, root, ["sensors"]);
  const completed = {
    findings_version: 2,
    sensor: { name, version: ownVersion(parsed) },
    commit,
    modified: isDirty(io, root),
    settings: {},
    reported_at: new Date(io.now()).toISOString(),
    findings,
    inputs: measuredInputs(scans),
  };

  let document: ReturnType<typeof validateFindings>;

  try {
    document = validateFindings(completed, { name });
  } catch (error) {
    io.stderr(`${(error as Error).message}\n`);

    return 1;
  }

  writeFindings(io, root, document);

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
