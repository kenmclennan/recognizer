import type { Io } from "./cli.js";
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
): StructureRun {
  const { commit, modified } = scansCommit(scans);
  const sensed = structureSensor(scans, policy, settings, {
    commit: commit ?? "",
    modified,
  });

  if (commit === null) {
    return { sensed, commit, error: null };
  }

  try {
    writeFindings(io, root, sensed.document);

    return { sensed, commit, error: null };
  } catch (error) {
    return { sensed, commit, error: (error as Error).message };
  }
}
