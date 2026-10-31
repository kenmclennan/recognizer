import { join } from "node:path";
import type { Io } from "./cli.js";
import { readConfig } from "./config.js";
import {
  type FindingsDocument,
  validateFindings,
} from "./findings-document.js";
import {
  findingsFile,
  readFindingsFiles,
  writeFindings,
} from "./findings-files.js";
import { type Policy, parsePolicy } from "./policy.js";
import type { RecordedScan, Scan } from "./scan.js";
import {
  resolveStructureSettings,
  type StructureSettings,
  structureSensor,
} from "./structure-sensor.js";

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

export function loadFindings(
  io: Io,
  root: string,
  scans: Scan[],
  options: { hubThreshold?: number } = {},
): FindingsDocument[] {
  const config = readConfig(io, root);
  const settings = resolveStructureSettings(config, options.hubThreshold);
  const { commit, modified } = scansCommit(scans);
  const documents: FindingsDocument[] = [];

  if (settings !== "off") {
    const context = { commit: commit ?? "", modified };
    const compute = () =>
      structureSensor(scans, readPolicy(io, root), settings, context).document;

    if (options.hubThreshold !== undefined || commit === null) {
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

  for (const outcome of readFindingsFiles(io, root, commit, ["structure"])) {
    if (outcome.status === "read") {
      documents.push(outcome.document);
    } else if (outcome.status === "stale") {
      io.stderr(`stale ${outcome.name}\n`);
    } else {
      io.stderr(`invalid ${outcome.name}: ${outcome.reason}\n`);
    }
  }

  return documents;
}
