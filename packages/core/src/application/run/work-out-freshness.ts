import type { Repository } from "../../domain/repository.js";
import { ResultFreshness } from "../../domain/run/result-freshness.js";
import type { ResultEntry } from "../../domain/run/result-set.js";
import { buildFreshness } from "../sensing/freshness.js";
import {
  freshnessScope,
  sensorFreshness,
} from "../sensing/sensor-freshness.js";

function latest(entries: readonly ResultEntry[]): ResultEntry | null {
  let chosen: ResultEntry | null = null;

  for (const entry of entries) {
    if (
      chosen === null ||
      (entry.result.reportedAt ?? "") >= (chosen.result.reportedAt ?? "")
    ) {
      chosen = entry;
    }
  }

  return chosen;
}

export function workOutFreshness(
  entries: readonly ResultEntry[],
  structure: Repository | null,
  scoped: boolean,
  currentTests: string | null = null,
): ResultFreshness {
  const held = latest(entries);

  if (structure === null) {
    return held === null
      ? ResultFreshness.neverRun()
      : ResultFreshness.stale(Object.keys(held.result.inputs ?? {}));
  }

  const measured =
    held === null
      ? null
      : {
          ...(held.result.inputs === null
            ? {}
            : { inputs: held.result.inputs }),
          ...(held.result.testsDigest === null
            ? {}
            : { tests: held.result.testsDigest }),
        };
  const hashes = structure.scannedHashes();
  const known = sensorFreshness(
    freshnessScope(
      [...hashes.keys()],
      structure,
      buildFreshness(
        structure,
        currentTests ?? held?.result.testsDigest ?? null,
      ),
    ),
    measured,
    scoped,
  );

  return known.kind === "never-run"
    ? ResultFreshness.neverRun()
    : ResultFreshness.known([...known.outOfDate, ...known.missing]);
}
