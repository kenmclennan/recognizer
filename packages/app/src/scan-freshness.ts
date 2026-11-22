import type {
  Freshness,
  LineKind,
  Measured,
  PlanMode,
  PlanRequest,
  PlanRow,
  ScanFacts,
  ScanIntent,
  ScanPlanView,
  SensorRow,
} from "recognizer";

export type {
  LineKind,
  Measured,
  PlanRequest,
  ScanFacts,
  ScanPlanView,
  SensorRow,
};

import type { FreshnessModel } from "./freshness-model";
import type { SensorStatus } from "./sensor-run";

export type ResultsMode = PlanMode;

export const DESCRIBE_KEY = "describe";

export const MUTATION_KEY = "mutation";

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

export type PlannedRun = {
  plan: ScanIntent;
  dropped: string[];
  modules: number;
  idle: boolean;
  label: string;
  progress: string;
  work: Record<string, number>;
  frozen?: Record<string, number>;
  suiteHistory?: Record<string, Record<string, number[]>>;
};

export const OPEN_RUN: PlannedRun = {
  plan: {
    describe: false,
    describeAll: false,
    analysis: true,
    sense: [],
    modules: null,
  },
  dropped: [],
  modules: 0,
  idle: true,
  label: "",
  progress: "",
  work: {},
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
        ? "1 file has changed since it was scanned. Its results are hidden, so this picture is partial."
        : `${count} files have changed since they were scanned. Their results are hidden, so this picture is partial.`;

    return {
      key: `scan-freshness:${model.changed.join(",")}`,
      text,
      label: `Update ${plural(count, "file")}`,
    };
  }

  const never = model.rows.find(
    (row) =>
      row.scoped && row.state.kind === "never-run" && model.ticked(row.key),
  );

  if (never === undefined) {
    return null;
  }

  return {
    key: `scan-freshness:${never.key}-never-run`,
    text: `${never.name} has not run here yet. Its results are missing from this picture.`,
    label: `Run ${never.name}`,
  };
}

export function plannedRun(
  model: FreshnessModel,
  mode: ResultsMode,
  view: ScanPlanView,
  rows: (PlanRow & { display?: string })[],
): PlannedRun {
  const label = model.action.primary.label;
  const base = {
    plan: view.intent,
    dropped: view.dropped,
    modules: mode === "rescan" ? view.modules : model.update.length,
    label,
    work: view.work,
  };

  if (mode === "rescan") {
    return {
      ...base,
      idle: false,
      progress: `Rescanning ${plural(base.modules, "file")}\u2026`,
    };
  }

  const display = new Map(
    rows.map(({ name, display }) => [name, display ?? name]),
  );
  const names = [
    ...(view.intent.describe ? ["Descriptions"] : []),
    ...view.intent.sense.map((name) => display.get(name) ?? name),
  ];

  return {
    ...base,
    idle: label === "Up to date",
    progress:
      base.modules > 0
        ? `Updating ${plural(base.modules, "file")}\u2026`
        : `Running ${joinNames(names)}\u2026`,
  };
}
