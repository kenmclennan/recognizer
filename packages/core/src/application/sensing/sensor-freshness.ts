import type { Measured, ScanFacts } from "../../domain/scan-plan.js";
import { type Freshness, scanHashes } from "./freshness.js";

export type SensorFreshness =
  | { kind: "never-run" }
  | { kind: "known"; outOfDate: string[]; missing: string[] };

export type FreshnessScope = {
  modules: string[];
  hashes: ReadonlyMap<string, string>;
  withFunctions: ReadonlySet<string>;
  freshness: Freshness;
};

export function modulesWithFunctions(scans: readonly ScanFacts[]): Set<string> {
  const ids = new Set<string>();

  for (const scan of scans) {
    for (const module of scan.modules) {
      const has = (module.members ?? []).some(
        (member) =>
          member.kind === "function" ||
          (member.kind === "class" && (member.methods?.length ?? 0) > 0),
      );

      if (has) {
        ids.add(module.id);
      }
    }
  }

  return ids;
}

export function freshnessScope(
  modules: string[],
  scans: readonly ScanFacts[],
  freshness: Freshness,
): FreshnessScope {
  return {
    modules,
    hashes: scanHashes(scans),
    withFunctions: modulesWithFunctions(scans),
    freshness,
  };
}

export function sensorFreshness(
  scope: FreshnessScope,
  measured: Measured | null,
  scoped: boolean,
): SensorFreshness {
  if (measured === null) {
    return { kind: "never-run" };
  }

  const { freshness, hashes, modules, withFunctions } = scope;

  if (!freshness.valid(measured)) {
    return { kind: "known", outOfDate: [...modules], missing: [] };
  }

  const outOfDate: string[] = [];
  const missing: string[] = [];

  for (const id of modules) {
    if (!hashes.has(id)) {
      continue;
    }

    if (measured.inputs?.[id] !== undefined) {
      if (!freshness.current(measured, id)) {
        outOfDate.push(id);
      }
    } else if (scoped && withFunctions.has(id)) {
      missing.push(id);
    }
  }

  return { kind: "known", outOfDate, missing };
}

export function staleModules(
  modules: readonly string[],
  measured: Measured,
  freshness: Freshness,
): Set<string> {
  if (!freshness.valid(measured)) {
    return new Set(modules);
  }

  return new Set(modules.filter((id) => !freshness.current(measured, id)));
}

export function gapOf(result: SensorFreshness, modules: string[]): string[] {
  if (result.kind === "never-run") {
    return [...modules];
  }

  const wanted = new Set([...result.outOfDate, ...result.missing]);

  return modules.filter((id) => wanted.has(id));
}
