import {
  carryMeasured,
  freshnessFor,
  type PolicyRule,
  type Repository,
  type SensorFindings,
  STRUCTURE_SENSOR_VERSION,
  type StructureSettings,
  scansCommit,
  senseStructure,
} from "@recognizer/core";
import { FindingsAdapter } from "./adapters/filesystem/findings-adapter.js";
import { readSensorFindings } from "./adapters/filesystem/findings-translator.js";
import { parsePolicy } from "./adapters/filesystem/policy-translator.js";
import { SourceFilesAdapter } from "./adapters/filesystem/source-files-adapter.js";
import { TomlAdapter } from "./adapters/filesystem/toml-adapter.js";
import { DigestAdapter } from "./adapters/system/digest-adapter.js";
import type { Io } from "./cli.js";
import { policyFile, readConfig } from "./config.js";
import { registeredSensors } from "./config-parse.js";
import {
  findingsFile,
  type ReadOutcome,
  readFindingsFiles,
  writeFindings,
} from "./findings-files.js";
import { shippedSensorNames } from "./shipped-sensors.js";
import { resolveStructureSettings } from "./structure-sensor.js";

export function readPolicy(io: Io, root: string): PolicyRule[] | null {
  const file = policyFile(root);

  if (!io.exists(file)) {
    return null;
  }

  return parsePolicy(io.readFile(file));
}

function withoutMeasured(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const {
    duplication: _duplication,
    complexity_limit: _complexityLimit,
    ...rest
  } = settings;

  return rest;
}

function complexityAgrees(
  document: SensorFindings,
  settings: StructureSettings,
): boolean {
  const recorded = document.settings.complexity_limit;

  if (!settings.warnings.complexity) {
    return recorded === undefined;
  }

  return recorded === undefined || recorded === settings.complexity_limit;
}

function duplicationAgrees(
  document: SensorFindings,
  settings: StructureSettings,
): boolean {
  const recorded = document.settings.duplication;

  if (settings.duplication === false) {
    return recorded === undefined;
  }

  return (
    recorded === undefined ||
    JSON.stringify(recorded) === JSON.stringify(settings.duplication)
  );
}

function storedStructure(
  io: Io,
  root: string,
  commit: string,
  settings: StructureSettings,
): SensorFindings | null {
  try {
    const document = readSensorFindings(
      JSON.parse(io.readFile(findingsFile(root, "structure"))),
      { name: "structure", commit },
    );

    return !document.modified &&
      document.sensor.version === STRUCTURE_SENSOR_VERSION &&
      duplicationAgrees(document, settings) &&
      complexityAgrees(document, settings) &&
      JSON.stringify(withoutMeasured(document.settings)) ===
        JSON.stringify(withoutMeasured({ ...settings }))
      ? document
      : null;
  } catch {
    return null;
  }
}

function noteOutOfDate(
  io: Io,
  outcome: Extract<ReadOutcome, { status: "read" }>,
): void {
  if (!outcome.valid) {
    io.stderr(
      outcome.reported
        ? `stale ${outcome.name} (reported at ${outcome.document.commit.slice(0, 7)})\n`
        : `stale ${outcome.name}\n`,
    );
  } else if (outcome.hidden.length > 0) {
    io.stderr(
      `out of date ${outcome.name}: ${outcome.hidden.length} findings\n`,
    );
  }
}

export function loadFindings(
  io: Io,
  root: string,
  repository: Repository,
): SensorFindings[] {
  const config = readConfig(io, root, ["sensors"]);
  const settings = resolveStructureSettings(config);
  const { commit, modified } = scansCommit(repository);
  const documents: SensorFindings[] = [];

  if (settings !== "off") {
    const context = { commit: commit ?? "", modified };
    const compute = () =>
      carryMeasured(
        new FindingsAdapter(io).readStructure(root),
        senseStructure(repository, readPolicy(io, root), settings, context)
          .document,
        settings,
      );

    if (commit === null) {
      documents.push(compute());
    } else {
      const stored = storedStructure(io, root, commit, settings);

      if (stored !== null) {
        documents.push(stored);
      } else {
        const fresh = compute();

        try {
          writeFindings(io, root, fresh);
        } catch {
          io.stderr("could not write structure findings\n");
        }

        documents.push(fresh);
      }
    }
  }

  const registered = [
    ...registeredSensors(config).map(({ name }) => name),
    ...shippedSensorNames(),
  ];

  for (const outcome of readFindingsFiles(
    io,
    root,
    freshnessFor(
      {
        source: new SourceFilesAdapter(io),
        digest: new DigestAdapter(),
        toml: new TomlAdapter(),
      },
      root,
      repository,
    ),
    ["structure"],
    registered,
  )) {
    if (outcome.status === "unregistered") {
      io.stderr(`ignored unregistered ${outcome.name}\n`);
    } else if (outcome.status === "read") {
      documents.push(outcome.document);
      noteOutOfDate(io, outcome);
    } else {
      io.stderr(`invalid ${outcome.name}: ${outcome.reason}\n`);
    }
  }

  return documents;
}
