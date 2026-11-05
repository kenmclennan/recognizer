import type { Scan } from "recognizer";
import { type Freshness, type Measured, scanHashes } from "recognizer";
import type { SensorStatus } from "./sensor-run";

export type SensorFreshness =
  | { kind: "never-run" }
  | { kind: "known"; outOfDate: string[]; missing: string[] };

export type FreshnessScope = {
  modules: string[];
  hashes: ReadonlyMap<string, string>;
  withFunctions: ReadonlySet<string>;
  freshness: Freshness;
};

export function modulesWithFunctions(scans: readonly Scan[]): Set<string> {
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
  scans: readonly Scan[],
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

export function gapOf(result: SensorFreshness, modules: string[]): string[] {
  if (result.kind === "never-run") {
    return [...modules];
  }

  const wanted = new Set([...result.outOfDate, ...result.missing]);

  return modules.filter((id) => wanted.has(id));
}

export function markStale(
  statuses: SensorStatus[],
  freshness: Freshness,
): SensorStatus[] {
  return statuses.map((one) => {
    if (one.status !== "ran" || one.measured === undefined) {
      return one;
    }

    const stale =
      !freshness.valid(one.measured) ||
      freshness.counts(one.measured, []).outOfDate > 0;

    return stale ? { ...one, status: "stale" } : one;
  });
}

export type ReportRowInput = {
  name: string;
  display: string;
  gap: string[];
  neverRun: boolean;
};

export type FreshnessReport = {
  complete: boolean;
  head: string;
  body: string;
  bar: { current: number; outOfDate: number } | null;
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function listed(ids: string[]): string {
  const shown = ids.slice(0, 5);
  const more = ids.length - shown.length;

  if (more > 0) {
    return `${shown.join(", ")} and ${more} more`;
  }

  return shown.length > 1
    ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`
    : shown.join("");
}

function neverRunHead(names: string[]): string {
  return names.length === 1
    ? `${names[0]} has not run`
    : `${listed(names)} have not run`;
}

export function freshnessReport(
  where: string,
  scope: string[],
  rows: ReportRowInput[],
): FreshnessReport | null {
  if (rows.length === 0) {
    return null;
  }

  const never = rows.filter(({ neverRun }) => neverRun);
  const union = new Set(
    rows.filter(({ neverRun }) => !neverRun).flatMap(({ gap }) => gap),
  );

  if (never.length === 0 && union.size === 0) {
    return {
      complete: true,
      head: "Complete picture",
      body: `Every result for ${where} is current: ${plural(scope.length, "module")} measured by all ${rows.length} sensors.`,
      bar: null,
    };
  }

  const parts: string[] = [];

  if (never.length > 0) {
    parts.push(neverRunHead(never.map(({ display }) => display)));
  }

  if (union.size > 0) {
    parts.push(`${union.size} of ${scope.length} modules out of date`);
  }

  const ordered = scope.filter((id) => union.has(id));
  const body =
    union.size > 0
      ? `${listed(ordered)} changed since they were scanned. Their bars, descriptions and findings are hidden until they are brought up to date.`
      : `Their values and findings for ${where} appear once it has run. Everything else is current.`;

  return {
    complete: false,
    head: `Partial picture: ${parts.join("; ")}`,
    body,
    bar:
      union.size > 0
        ? { current: scope.length - union.size, outOfDate: union.size }
        : null,
  };
}
