import type { Scan } from "recognizer";
import { type Freshness, type Measured, scanHashes } from "recognizer";
import type { FreshnessModel } from "./freshness-model";
import type { ScanPlan, ScanTicks } from "./scan-panel-model";
import type { SensorStatus } from "./sensor-run";
import { type SuiteRef, suitePlan } from "./suite-ticks";

export type ResultsMode = "bring" | "rescan";

export const DESCRIBE_KEY = "describe";
export const MUTATION_KEY = "mutation";

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

export type FreshnessMessage = {
  key: string;
  text: string;
  label: string;
};

export type PlanRow = {
  name: string;
  runsTests: boolean;
  suites?: SuiteRef[];
};

export type PlannedRun = {
  plan: ScanPlan;
  dropped: string[];
  modules: number;
  idle: boolean;
  label: string;
  progress: string;
};

export const OPEN_RUN: PlannedRun = {
  plan: {
    describe: false,
    describeAll: false,
    sense: [],
    modules: null,
    suites: {},
  },
  dropped: [],
  modules: 0,
  idle: true,
  label: "",
  progress: "",
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) {
    return names.join("");
  }

  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function freshnessMessage(
  model: FreshnessModel,
): FreshnessMessage | null {
  if (model.changed.length > 0) {
    const count = model.changed.length;
    const text =
      count === 1
        ? "1 module has changed since it was scanned. Its results are hidden, so this picture is partial."
        : `${count} modules have changed since they were scanned. Their results are hidden, so this picture is partial.`;

    return {
      key: `scan-freshness:${model.changed.join(",")}`,
      text,
      label: `Update ${plural(count, "module")}`,
    };
  }

  const mutation = model.rows.find(({ key }) => key === MUTATION_KEY);

  if (
    mutation === undefined ||
    mutation.state.kind !== "never-run" ||
    !model.ticked(MUTATION_KEY)
  ) {
    return null;
  }

  return {
    key: "scan-freshness:mutation-never-run",
    text: "Mutation has not run here yet. Survived-mutant results are missing from this picture.",
    label: `Run ${mutation.name}`,
  };
}

export function tickedPhases(
  ticks: ScanTicks,
  rows: PlanRow[],
): {
  describe: boolean;
  sense: string[];
  suites: Record<string, string[]>;
  dropped: string[];
} {
  const testing = rows
    .filter(({ runsTests }) => runsTests)
    .map(({ name }) => name);
  const plain = rows
    .filter(({ runsTests }) => !runsTests)
    .map(({ name }) => name);
  const wanted = ticks.ticked ?? plain;
  const known = [...plain, ...testing];
  const planned = suitePlan(
    ticks,
    rows.filter(({ runsTests }) => runsTests),
    ticks.once,
  );

  return {
    describe: ticks.describe,
    sense: [
      ...wanted.filter((name) => plain.includes(name)),
      ...testing.filter((name) => planned.sense.includes(name)),
    ],
    suites: planned.suites,
    dropped: wanted.filter((name) => !known.includes(name)),
  };
}

function inOrder(ids: Set<string>, order: string[]): string[] {
  return order.filter((id) => ids.has(id));
}

export function planFor(
  model: FreshnessModel,
  mode: ResultsMode,
  ticks: ScanTicks,
  rows: (PlanRow & { display?: string })[],
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
        suites: phases.suites,
      },
      dropped: phases.dropped,
      modules: total,
      idle: false,
      label: model.action.primary.label,
      progress: `Rescanning ${plural(total, "module")}\u2026`,
    };
  }

  const gapOfRow = (name: string): string[] => model.gaps.get(name) ?? [];
  const kindOf = (name: string) =>
    model.rows.find(({ key }) => key === name)?.state.kind;
  const describe = phases.describe && gapOfRow(DESCRIBE_KEY).length > 0;
  const sense = phases.sense.filter(
    (name) =>
      !model.gaps.has(name) ||
      kindOf(name) === "never-run" ||
      gapOfRow(name).length > 0,
  );
  const scopedIds = new Set<string>();

  if (describe) {
    for (const id of gapOfRow(DESCRIBE_KEY)) {
      scopedIds.add(id);
    }
  }

  if (sense.includes(MUTATION_KEY)) {
    for (const id of gapOfRow(MUTATION_KEY)) {
      scopedIds.add(id);
    }
  }

  const changed = model.update.length;
  const names = [
    ...(describe ? ["Descriptions"] : []),
    ...sense.map((name) => display.get(name) ?? name),
  ];

  return {
    plan: {
      describe,
      describeAll: false,
      sense,
      modules: scopedIds.size === 0 ? null : inOrder(scopedIds, order),
      suites: Object.fromEntries(
        Object.entries(phases.suites).filter(([name]) => sense.includes(name)),
      ),
    },
    dropped: phases.dropped,
    modules: changed,
    idle: model.action.primary.label === "Up to date",
    label: model.action.primary.label,
    progress:
      changed > 0
        ? `Updating ${plural(changed, "module")}\u2026`
        : `Running ${joinNames(names)}\u2026`,
  };
}
