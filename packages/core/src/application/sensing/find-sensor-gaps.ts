import type { SensorRow } from "../../domain/scan-plan.js";
import type { Store } from "../shared/ports/store.js";
import { buildFreshness } from "./freshness.js";
import { freshnessScope, gapOf, sensorFreshness } from "./sensor-freshness.js";

export interface SensorGaps {
  gaps: Record<string, string[]>;
  never: string[];
}

export function findSensorGaps(
  ports: {
    store: Pick<Store, "cachedRepository" | "measuredOf" | "testsDigest">;
  },
  root: string,
  rows: readonly SensorRow[],
  modules: string[],
): SensorGaps {
  const repository = ports.store.cachedRepository(root);
  const freshness = buildFreshness(repository, ports.store.testsDigest(root));
  const scope = freshnessScope(modules, repository, freshness);
  const gaps: Record<string, string[]> = {};
  const never: string[] = [];

  for (const row of rows.filter(({ registered }) => registered)) {
    const result = sensorFreshness(
      scope,
      ports.store.measuredOf(root, row.name),
      row.scoped,
    );

    gaps[row.name] = gapOf(result, modules);

    if (result.kind === "never-run") {
      never.push(row.name);
    }
  }

  return { gaps, never };
}
