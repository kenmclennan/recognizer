import { join } from "node:path";
import type { Io } from "./cli.js";
import { readConfig } from "./config.js";
import { registeredSensors } from "./config-parse.js";
import {
  type FindingsDocument,
  validateFindings,
} from "./findings-document.js";
import {
  findingsFile,
  type ReadOutcome,
  readFindingsFiles,
  writeFindings,
} from "./findings-files.js";
import { type Policy, parsePolicy } from "./policy.js";
import type { RecordedScan, Scan } from "./scan.js";
import { shippedSensorNames } from "./shipped-sensors.js";
import {
  resolveStructureSettings,
  type StructureSettings,
  structureSensor,
} from "./structure-sensor.js";
import { freshnessFor } from "./tests-hash.js";

export function readPolicy(io: Io, root: string): Policy | null {
  const file = join(root, ".recognizer", "policy.yaml");

  if (!io.exists(file)) {
    return null;
  }

  return parsePolicy(io.readFile(file));
}

export function scansCommit(scans: Scan[]): {
  commit: string | null;
  modified: boolean;
} {
  const recorded = scans as RecordedScan[];

  return {
    commit: recorded[0]?.commit ?? null,
    modified: recorded.some((scan) => scan.modified !== false),
  };
}

function storedStructure(
  io: Io,
  root: string,
  commit: string,
  settings: StructureSettings,
): FindingsDocument | null {
  try {
    const document = validateFindings(
      JSON.parse(io.readFile(findingsFile(root, "structure"))),
      { name: "structure", commit },
    );

    return !document.modified &&
      JSON.stringify(document.settings) === JSON.stringify(settings)
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
  scans: Scan[],
): FindingsDocument[] {
  const config = readConfig(io, root, ["sensors"]);
  const settings = resolveStructureSettings(config);
  const { commit, modified } = scansCommit(scans);
  const documents: FindingsDocument[] = [];

  if (settings !== "off") {
    const context = { commit: commit ?? "", modified };
    const compute = () =>
      structureSensor(scans, readPolicy(io, root), settings, context).document;

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
    freshnessFor(io, root, scans),
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
