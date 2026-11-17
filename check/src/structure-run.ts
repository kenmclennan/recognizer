import type { Io } from "./cli.js";
import { packageVersion } from "./cli.js";
import { measureComplexityValues } from "./complexity/measure.js";
import { carryMeasured } from "./duplication/carry.js";
import type { DuplicationSettings } from "./duplication/findings.js";
import { measureDuplication } from "./duplication/measure.js";
import type { Parsers } from "./duplication/parsers.js";
import { readStoredStructure } from "./duplication/stored.js";
import type { FindingRecord } from "./findings-document.js";
import { writeFindings } from "./findings-files.js";
import { scansCommit } from "./load-findings.js";
import type { Policy } from "./policy.js";
import type { Scan } from "./scan.js";
import {
  buildStructureOverlay,
  writeStructureOverlay,
} from "./structure-overlay.js";
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
  const errors: string[] = [];
  let sensed: StructureResult;
  let complexityValues: Record<string, number> | null = null;
  let duplicationFindings: FindingRecord[] | null = null;

  if (parsers !== null) {
    const attempt = (
      label: string,
      wanted: boolean,
      measure: (loaded: Parsers) => FindingRecord[],
    ): FindingRecord[] | null => {
      if (!wanted) {
        return null;
      }

      try {
        return measure(parsers);
      } catch (error) {
        errors.push(`${label}: ${(error as Error).message}`);

        return null;
      }
    };

    duplicationFindings = attempt(
      "duplication",
      settings.duplication !== false,
      (loaded) =>
        measureDuplication(
          io,
          root,
          scans,
          settings.duplication as DuplicationSettings,
          loaded,
          true,
        ),
    );

    const complexity = attempt(
      "complexity",
      settings.warnings.complexity,
      (loaded) => {
        const measured = measureComplexityValues(
          io,
          root,
          scans,
          policy,
          settings,
          loaded,
        );

        complexityValues = measured.values;

        return measured.findings;
      },
    );

    sensed = structureSensor(scans, policy, settings, context, {
      duplication: duplicationFindings,
      complexity,
    });
  } else {
    const plain = structureSensor(scans, policy, settings, context);

    sensed = {
      ...plain,
      document: carryMeasured(
        readStoredStructure(io, root),
        plain.document,
        settings,
      ),
    };
  }

  const measureError = errors.length > 0 ? errors.join("; ") : null;

  if (commit === null) {
    return { sensed, commit, error: measureError };
  }

  try {
    writeFindings(io, root, sensed.document);

    if (parsers !== null) {
      writeStructureOverlay(
        io,
        root,
        buildStructureOverlay({
          commit,
          modified,
          version: packageVersion(),
          scans,
          complexity: complexityValues,
          duplication: duplicationFindings,
        }),
      );
    }

    return { sensed, commit, error: measureError };
  } catch (error) {
    return { sensed, commit, error: (error as Error).message };
  }
}
