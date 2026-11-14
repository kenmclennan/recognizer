import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { configFile, readConfig } from "./config.js";
import { findDescriber } from "./describer-in-effect.js";
import { detectLanguages } from "./detect.js";
import {
  buildReport,
  type DoctorFacts,
  reportJson,
  reportText,
} from "./doctor.js";
import { InputError } from "./errors.js";
import { cachedScansState } from "./freshness.js";
import { discoverPlugins, findOnPath } from "./plugin-discovery.js";
import type { PluginFact, PluginSpec } from "./plugin-doctor.js";
import { judgeProtocol, readManifest } from "./plugin-manifest.js";
import { languageRulesOf } from "./scanners.js";
import { checkSensor } from "./sensors-check.js";
import {
  readShippedSensors,
  SHIPPED_SENSORS,
  shippedSensorOf,
  withSuiteSettings,
} from "./shipped-sensors.js";

const USAGE = ["usage: recognizer doctor [REPOSITORY] [--json]"];

function readIfPresent(io: Io, file: string): string | null {
  return io.exists(file) ? io.readFile(file) : null;
}

function describerGaps(io: Io, root: string, program: string): string[] {
  const result = io.run(program, ["check"], { cwd: root });

  if (result.started && result.status === 0) {
    return [];
  }

  return [
    result.started
      ? `${program} check exited ${result.status ?? "without a status"}`
      : `${program} check could not be started`,
  ];
}

function suitesOf(io: Io, root: string): readonly unknown[] | undefined {
  try {
    return readConfig(io, root, ["tests"])?.tests;
  } catch {
    return undefined;
  }
}

function pluginFact(
  io: Io,
  root: string,
  spec: PluginSpec,
  suites: readonly unknown[] | undefined,
): PluginFact {
  const found = findOnPath(io, spec.program);

  if (found === null) {
    return { ...spec, state: { status: "missing" } };
  }

  const read = readManifest(io, found);

  if (!read.ok) {
    return { ...spec, state: { status: "unreadable", reason: read.reason } };
  }

  const { manifest } = read;
  const judgement = judgeProtocol(manifest);
  const wantsCheck = manifest.check && judgement !== "unsupported";
  const report =
    wantsCheck && spec.kind === "sensor"
      ? checkSensor(
          io,
          root,
          {
            name: spec.subject,
            command: [
              found,
              ...withSuiteSettings(
                spec.command,
                readShippedSensors(
                  io,
                  () => read,
                  [shippedSensorOf(spec.command)].filter(
                    (name): name is string => name !== undefined,
                  ),
                ),
                suites,
              ).slice(1),
            ],
          },
          {},
          () => read,
        )
      : null;

  return {
    ...spec,
    state: {
      status: "read",
      manifest,
      judgement,
      gaps: !wantsCheck
        ? null
        : report !== null
          ? report.gaps.map((gap) => gap.line)
          : describerGaps(io, root, found),
    },
  };
}

function describerShipped(io: Io, root: string): boolean {
  try {
    return findDescriber(io, root)?.source === "shipped";
  } catch {
    return false;
  }
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

  const scanners = discoverPlugins(io, ["scanner"]).plugins;
  const languages = detectLanguages(io, root, languageRulesOf(scanners));
  const facts: DoctorFacts = {
    repository: root,
    named: given !== undefined,
    configText: readIfPresent(io, configFile(root)),
    policyText: readIfPresent(io, join(root, ".recognizer", "policy.yaml")),
    languages,
    scans: () => cachedScansState(io, root, languages),
    scanners,
    plugins: (specs) => {
      const suites = suitesOf(io, root);

      return specs.map((spec) => pluginFact(io, root, spec, suites));
    },
    shipped: {
      sensors: SHIPPED_SENSORS.filter(
        (name) => findOnPath(io, `recognizer-sense-${name}`) !== null,
      ),
      describer: describerShipped(io, root),
    },
  };
  const report = buildReport(facts);

  io.stdout(values.json === true ? reportJson(report) : reportText(report));

  return report.ok ? 0 : 1;
}
