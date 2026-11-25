import { DESCRIBE_KEY } from "../../domain/run/result-state.js";
import type { PlanRequest, ScanPlanView } from "../../domain/run/scan-plan.js";
import type {
  ScanIntent,
  ScanTicks,
  SensorRow,
} from "../../domain/scan-plan.js";
import { suitePlan } from "../sensing/suite-ticks.js";

export type PlanRow = Pick<SensorRow, "name" | "runsTests" | "suites"> & {
  display?: string;
  scoped?: boolean;
  registered?: boolean;
};

export type PlanFacts = {
  gaps: ReadonlyMap<string, string[]>;
  never: ReadonlySet<string>;
};

export interface PlanPhases {
  readSensorRows(root: string): SensorRow[];
  readModules(root: string): string[];
  findSensorGaps(
    root: string,
    rows: SensorRow[],
    modules: string[],
  ): { gaps: Record<string, string[]>; never: string[] };
  findDescribeGap(root: string, modules: string[]): string[] | null;
}

export function tickedPhases(
  ticks: ScanTicks,
  every: PlanRow[],
): {
  describe: boolean;
  sense: string[];
  suites: Record<string, string[]>;
  dropped: string[];
} {
  const rows = every.filter(({ registered }) => registered !== false);
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
    ticks.armed,
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

export function suitesForSense(
  sense: string[],
  suites: Record<string, string[]>,
): Record<string, string[]> | undefined {
  const sensed = Object.fromEntries(
    Object.entries(suites).filter(
      ([name, names]) => sense.includes(name) && names.length > 0,
    ),
  );

  return Object.keys(sensed).length > 0 ? sensed : undefined;
}

export function workOf(
  describe: number | null,
  sense: string[],
  scoped: number | null,
  all: number,
  scopedNames: ReadonlySet<string>,
): Record<string, number> {
  const work: Record<string, number> = {};

  if (describe !== null) {
    work[DESCRIBE_KEY] = describe;
  }

  for (const name of sense) {
    work[name] = scopedNames.has(name) ? (scoped ?? all) : all;
  }

  return work;
}

function recorded(facts: PlanFacts): {
  gaps: Record<string, string[]>;
  never: string[];
} {
  return {
    gaps: Object.fromEntries(facts.gaps),
    never: [...facts.never],
  };
}

export function planFor(
  request: Pick<PlanRequest, "mode" | "ticks" | "scope" | "changed">,
  rows: PlanRow[],
  facts: PlanFacts,
  all: string[],
): ScanPlanView {
  const { mode, ticks, scope, changed } = request;
  const phases = tickedPhases(ticks, rows);
  const order = scope ?? all;
  const scopedNames = new Set(
    rows.filter(({ scoped }) => scoped === true).map(({ name }) => name),
  );
  const seen = recorded(facts);

  if (mode === "rescan") {
    const total = order.length;
    const any = phases.describe || phases.sense.length > 0;
    const intent: ScanIntent = {
      describe: phases.describe,
      describeAll: true,
      analysis: ticks.analysis,
      sense: phases.sense,
      modules: scope !== null && any ? scope : null,
      suites: suitesForSense(phases.sense, phases.suites),
    };

    return {
      intent,
      dropped: phases.dropped,
      modules: total,
      idle: false,
      work: workOf(
        phases.describe ? total : null,
        phases.sense,
        scope !== null && any ? scope.length : null,
        all.length,
        scopedNames,
      ),
      ...seen,
    };
  }

  const gapOfRow = (name: string): string[] => facts.gaps.get(name) ?? [];
  const describe = phases.describe && gapOfRow(DESCRIBE_KEY).length > 0;
  const sense = phases.sense.filter(
    (name) =>
      !facts.gaps.has(name) ||
      facts.never.has(name) ||
      changed.length > 0 ||
      gapOfRow(name).length > 0,
  );
  const scopedIds = new Set<string>();

  if (describe) {
    for (const id of gapOfRow(DESCRIBE_KEY)) {
      scopedIds.add(id);
    }
  }

  for (const name of sense.filter((one) => scopedNames.has(one))) {
    for (const id of [...gapOfRow(name), ...changed]) {
      scopedIds.add(id);
    }
  }

  const planModules = scopedIds.size === 0 ? null : inOrder(scopedIds, order);
  const intent: ScanIntent = {
    describe,
    describeAll: false,
    analysis: ticks.analysis,
    sense,
    modules: planModules,
    suites: suitesForSense(sense, phases.suites),
  };
  const anyGap = [...facts.gaps.values()].some((ids) => ids.length > 0);

  return {
    intent,
    dropped: phases.dropped,
    modules: changed.length,
    idle: !describe && sense.length === 0 && !anyGap && changed.length === 0,
    work: workOf(
      describe ? gapOfRow(DESCRIBE_KEY).length : null,
      sense,
      planModules === null ? null : planModules.length,
      all.length,
      scopedNames,
    ),
    ...seen,
  };
}

export function planScan(
  phases: PlanPhases,
  request: PlanRequest,
): ScanPlanView {
  const root = request.repository;
  const rows = phases.readSensorRows(root);
  const all = phases.readModules(root);
  const modules = request.scope ?? all;
  const { gaps, never } = phases.findSensorGaps(root, rows, modules);
  const describeGap = phases.findDescribeGap(root, modules);
  const found = new Map(Object.entries(gaps));

  if (describeGap !== null) {
    found.set(DESCRIBE_KEY, describeGap);
  }

  return planFor(request, rows, { gaps: found, never: new Set(never) }, all);
}
