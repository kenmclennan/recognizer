import type { Scan } from "recognizer";
import { type Freshness, type Measured, scanHashes } from "recognizer";
import type { ScanPlan, ScanTicks } from "./scan-panel-model";
import type { SensorStatus } from "./sensor-run";

export type ResultsMode = "bring" | "rescan";

export const DESCRIBE_ROW = "describe";
export const SCOPED_SENSOR = "mutation";

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
  outOfDate: string[];
  neverRun: string[];
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
      outOfDate: [],
      neverRun: [],
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
    outOfDate: ordered,
    neverRun: never.map(({ name }) => name),
  };
}

export type FreshnessMessage = {
  key: string;
  text: string;
  neverRunOnly: boolean;
};

export function freshnessMessage(
  report: FreshnessReport | null,
): FreshnessMessage | null {
  if (report === null || report.complete) {
    return null;
  }

  if (report.outOfDate.length > 0) {
    const count = report.outOfDate.length;
    const text =
      count === 1
        ? "1 module has changed since it was scanned. Its results are hidden, so this picture is partial."
        : `${count} modules have changed since they were scanned. Their results are hidden, so this picture is partial.`;

    return {
      key: `scan-freshness:${report.outOfDate.join(",")}`,
      text,
      neverRunOnly: false,
    };
  }

  if (report.neverRun.includes(SCOPED_SENSOR)) {
    return {
      key: "scan-freshness:mutation-never-run",
      text: "Mutation has not run here yet. Survived-mutant results are missing from this picture.",
      neverRunOnly: true,
    };
  }

  return null;
}

export function coverageNote(
  report: FreshnessReport | null,
  scopeSize: number,
): string | null {
  if (report === null || report.outOfDate.length === 0) {
    return null;
  }

  return `from ${scopeSize - report.outOfDate.length} of ${scopeSize} modules`;
}

export type PlanRow = { name: string; runsTests: boolean };

export type RowGap = { gap: string[]; neverRun: boolean };

export type PlannedRun = {
  plan: ScanPlan;
  dropped: string[];
  modules: number;
  idle: boolean;
  label: string;
  progress: string;
};

export function tickedPhases(
  ticks: ScanTicks,
  rows: PlanRow[],
): { describe: boolean; sense: string[]; dropped: string[] } {
  const testing = rows
    .filter(({ runsTests }) => runsTests)
    .map(({ name }) => name);
  const plain = rows
    .filter(({ runsTests }) => !runsTests)
    .map(({ name }) => name);
  const wanted = ticks.ticked ?? plain;
  const known = [...plain, ...testing];

  return {
    describe: ticks.describe,
    sense: [
      ...wanted.filter((name) => plain.includes(name)),
      ...testing.filter((name) => ticks.once.includes(name)),
    ],
    dropped: wanted.filter((name) => !known.includes(name)),
  };
}

function inOrder(ids: Set<string>, order: string[]): string[] {
  return order.filter((id) => ids.has(id));
}

function runLabel(names: string[], display: Map<string, string>): string {
  const shown = names.map((name) => display.get(name) ?? name);

  return shown.length === 1 ? `Run ${shown[0]}` : `Run ${shown.length} sensors`;
}

export function planFor(
  mode: ResultsMode,
  ticks: ScanTicks,
  rows: (PlanRow & { display?: string })[],
  gaps: ReadonlyMap<string, RowGap>,
  scope: string[] | null,
  all: string[],
): PlannedRun {
  const phases = tickedPhases(ticks, rows);
  const display = new Map(
    rows.map(({ name, display }) => [name, display ?? name]),
  );
  const order = scope ?? all;

  if (mode === "rescan") {
    const total = order.length;
    const any = phases.describe || phases.sense.length > 0;

    return {
      plan: {
        describe: phases.describe,
        describeAll: true,
        sense: phases.sense,
        modules: scope !== null && any ? scope : null,
      },
      dropped: phases.dropped,
      modules: total,
      idle: false,
      label: `Rescan ${total} ${total === 1 ? "module" : "modules"}`,
      progress: `Rescanning ${total} ${total === 1 ? "module" : "modules"}\u2026`,
    };
  }

  const gapOfRow = (name: string): RowGap | undefined => gaps.get(name);
  const describe =
    phases.describe && (gapOfRow(DESCRIBE_ROW)?.gap.length ?? 0) > 0;
  const sense = phases.sense.filter((name) => {
    const found = gapOfRow(name);

    return found === undefined || found.neverRun || found.gap.length > 0;
  });
  const scopedIds = new Set<string>();

  if (describe) {
    for (const id of gapOfRow(DESCRIBE_ROW)?.gap ?? []) {
      scopedIds.add(id);
    }
  }

  if (sense.includes(SCOPED_SENSOR)) {
    for (const id of gapOfRow(SCOPED_SENSOR)?.gap ?? []) {
      scopedIds.add(id);
    }
  }

  const union = new Set<string>();

  for (const name of phases.describe ? [DESCRIBE_ROW] : []) {
    for (const id of gapOfRow(name)?.gap ?? []) {
      union.add(id);
    }
  }

  for (const name of phases.sense) {
    const found = gapOfRow(name);

    if (found !== undefined && !found.neverRun) {
      for (const id of found.gap) {
        union.add(id);
      }
    }
  }

  const never = phases.sense.filter((name) => gapOfRow(name)?.neverRun);
  const nothingTicked = !phases.describe && phases.sense.length === 0;
  const idle = !nothingTicked && !describe && sense.length === 0;
  const count = union.size;
  const progress = `Bringing ${count} ${count === 1 ? "module" : "modules"} up to date\u2026`;
  const label = nothingTicked
    ? "Run"
    : idle
      ? "Up to date"
      : count > 0
        ? `Bring ${count} ${count === 1 ? "module" : "modules"} up to date`
        : runLabel(never.length > 0 ? never : sense, display);

  return {
    plan: {
      describe,
      describeAll: false,
      sense,
      modules: scopedIds.size === 0 ? null : inOrder(scopedIds, order),
    },
    dropped: phases.dropped,
    modules: count,
    idle,
    label,
    progress,
  };
}
