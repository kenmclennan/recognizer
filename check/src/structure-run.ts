import type { Io } from "./cli.js";
import { carryDuplication } from "./duplication/carry.js";
import { measureDuplication } from "./duplication/measure.js";
import type { Parsers } from "./duplication/parsers.js";
import { readStoredStructure } from "./duplication/stored.js";
import { writeFindings } from "./findings-files.js";
import { scansCommit } from "./load-findings.js";
import type { Policy } from "./policy.js";
import type { Scan } from "./scan.js";
import {
  type StructureResult,
  type StructureSettings,
  structureSensor,
} from "./structure-sensor.js";

export interface StructureRun {
  sensed: StructureResult;
  commit: string | null;
  error: string | null;
}

export function runStructureSensor(
  io: Io,
  root: string,
  scans: Scan[],
  policy: Policy | null,
  settings: StructureSettings,
  parsers: Parsers | null = null,
): StructureRun {
  const { commit, modified } = scansCommit(scans);
  const context = { commit: commit ?? "", modified };
  let measureError: string | null = null;
  let sensed: StructureResult;

  if (settings.duplication !== false && parsers !== null) {
    try {
      sensed = structureSensor(
        scans,
        policy,
        settings,
        context,
        measureDuplication(
          io,
          root,
          scans,
          settings.duplication,
          parsers,
          true,
        ),
      );
    } catch (error) {
      measureError = `duplication: ${(error as Error).message}`;
      sensed = structureSensor(scans, policy, settings, context);
    }
  } else {
    const plain = structureSensor(scans, policy, settings, context);

    sensed = {
      ...plain,
      document: carryDuplication(
        readStoredStructure(io, root),
        plain.document,
        settings,
      ),
    };
  }

  if (commit === null) {
    return { sensed, commit, error: measureError };
  }

  try {
    writeFindings(io, root, sensed.document);

    return { sensed, commit, error: measureError };
  } catch (error) {
    return { sensed, commit, error: (error as Error).message };
  }
}
