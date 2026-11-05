import { type Overlay, validateOverlay } from "recognizer";
import { ageText } from "./footer-scan";
import type { Freshness } from "./freshness";
import type { SensorStatus, ShippedSensors } from "./sensor-run";

export type OverlayFileInput = {
  name: string;
  text: string;
  modifiedMs?: number | null;
};

export type OverlayContext = {
  sensors: readonly SensorStatus[];
  shipped: ShippedSensors | null;
};

export type GroupNote = { text: string; tone: "warn" | "muted" };

export type MetricType = "ratio" | "count" | "number" | "boolean";
export type MetricValue = number | boolean;

export type MetricDescriptor = {
  key: string;
  label: string;
  title: string;
  description?: string;
  granularity: "module" | "member";
  type: MetricType;
  bad: "high" | "low";
  overlay: string;
  max: number;
  values: Record<string, MetricValue>;
};

export type OverlayGroup = {
  name: string;
  title: string;
  measuredAt: number | null;
  verb: "measured" | "stopped";
  notes: GroupNote[];
  enabled: boolean;
  tooltip: string;
  outOfDate: number;
  total: number;
  metrics: MetricDescriptor[];
};

export type OverlayModel = {
  groups: OverlayGroup[];
  metrics: MetricDescriptor[];
  unreadable: string[];
};

export type ModuleValue = { value: MetricValue; member: string | null };

export const TITLES: Record<string, string> = {
  complexity: "Complexity",
  coverage: "Coverage",
  line_coverage: "Line coverage",
  crap: "C.R.A.P.",
  survived: "Survived mutants",
  killed: "Killed mutants",
  uncovered: "Uncovered mutants",
  score: "Mutation score",
};

export const DESCRIPTIONS: Record<string, string> = {
  complexity: "Cyclomatic complexity of each function",
  coverage: "Share of each function's lines the tests ran",
  line_coverage: "Share of a module's lines the tests ran",
  crap: "Change risk: complexity weighted by missing coverage",
  survived: "Changes to each function the tests did not catch",
  killed: "Changes to each function the tests caught",
  uncovered: "Changes to each function no test reaches",
  score: "Share of tested changes the tests caught",
};

const SHORT = 7;

function tooltipOf(overlay: Overlay): string {
  const commit = overlay.commit.slice(0, SHORT);
  const producer = `${overlay.producer.name} ${overlay.producer.version}`;

  return `${producer} - at ${commit}${overlay.modified ? ", modified tree" : ""}`;
}

function largest(values: Record<string, MetricValue>): number {
  let max = 0;

  for (const value of Object.values(values)) {
    if (typeof value === "number" && value > max) {
      max = value;
    }
  }

  return max;
}

type MetricSpec = {
  name: string;
  type: MetricType;
  granularity: "module" | "member";
  bad: "high" | "low";
};

function describe(
  group: string,
  metric: MetricSpec,
  values: Record<string, MetricValue>,
): MetricDescriptor {
  const description = DESCRIPTIONS[metric.name];

  return {
    key: `${group}/${metric.name}`,
    label: metric.name,
    title: TITLES[metric.name] ?? metric.name,
    ...(description === undefined ? {} : { description }),
    granularity: metric.granularity,
    type: metric.type,
    bad: metric.bad,
    overlay: group,
    max: largest(values),
    values,
  };
}

function plural(count: number): string {
  return count.toLocaleString("en-US");
}

export function groupHeader(group: OverlayGroup, now: number): string {
  return group.measuredAt === null
    ? ""
    : `${group.verb} ${ageText(group.measuredAt, now)}`;
}

function valueKeysOf(overlay: Overlay): string[] {
  return Object.values(overlay.values).flatMap((values) => Object.keys(values));
}

function currentValues(
  values: Record<string, MetricValue>,
  overlay: Overlay,
  freshness: Freshness,
): Record<string, MetricValue> {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) =>
      freshness.current(overlay, freshness.moduleOf(key)),
    ),
  );
}

export function buildOverlayModel(
  files: readonly OverlayFileInput[],
  freshness: Freshness,
  context: OverlayContext = { sensors: [], shipped: null },
): OverlayModel {
  const built = new Map<string, OverlayGroup>();
  const unreadable: string[] = [];
  const shipped =
    context.shipped?.status === "ok" ? context.shipped.sensors : [];
  const display = new Map(
    shipped.map((sensor) => [sensor.name, sensor.display]),
  );
  const sorted = [...files].sort((a, b) => compare(a.name, b.name));

  for (const file of sorted) {
    let overlay: Overlay;

    try {
      const parsed = JSON.parse(file.text) as Overlay;

      overlay = validateOverlay(parsed, {
        commit: parsed.commit,
        modified: parsed.modified,
        metrics: parsed.metrics,
      });
    } catch {
      unreadable.push(file.name);

      continue;
    }

    const title = display.get(file.name) || file.name;
    const counts = freshness.counts(overlay, valueKeysOf(overlay));
    const allOutOfDate = counts.total > 0 && counts.outOfDate === counts.total;
    const values = (name: string) =>
      currentValues(overlay.values[name] ?? {}, overlay, freshness);
    const found = context.sensors.find((status) => status.name === file.name);
    const facts = found?.commit === overlay.commit ? found : undefined;
    const stopped = facts?.stopped;
    const nothing = stopped !== undefined && stopped.measured === 0;
    const notes: GroupNote[] = [];

    if (nothing) {
      notes.push({
        text: "Stopped before any function finished, so there is nothing to show.",
        tone: "muted",
      });
    } else {
      if (counts.outOfDate > 0) {
        notes.push({
          text: `${title}: ${plural(counts.outOfDate)} of ${plural(counts.total)} modules out of date. Run ${title} to refresh.`,
          tone: "warn",
        });
      }

      if (facts?.partial !== undefined) {
        notes.push({
          text: `Partial: ${plural(facts.partial.measured)} of ${plural(facts.partial.total)} functions measured. The rest are uncoloured.`,
          tone: "warn",
        });
      }
    }

    built.set(file.name, {
      name: file.name,
      title,
      measuredAt: file.modifiedMs ?? null,
      verb: stopped === undefined ? "measured" : "stopped",
      notes,
      enabled: !nothing && !allOutOfDate,
      tooltip: tooltipOf(overlay),
      ...counts,
      metrics: overlay.metrics.map((metric) =>
        describe(file.name, metric, values(metric.name)),
      ),
    });
  }

  const groups: OverlayGroup[] = [];
  const present = new Set(files.map((file) => file.name));

  for (const sensor of shipped) {
    if (sensor.metrics === undefined || sensor.metrics.length === 0) {
      continue;
    }

    const have = built.get(sensor.name);

    if (have !== undefined) {
      groups.push(have);
      built.delete(sensor.name);

      continue;
    }

    if (present.has(sensor.name)) {
      continue;
    }

    const status = context.sensors.find((entry) => entry.name === sensor.name);
    const read = status !== undefined && status.status !== "not run";
    const nothing = status?.stopped?.measured === 0;

    if (read && !nothing) {
      continue;
    }

    groups.push({
      name: sensor.name,
      title: sensor.display,
      measuredAt: nothing ? (status?.modifiedMs ?? null) : null,
      verb: nothing ? "stopped" : "measured",
      notes: [
        nothing
          ? {
              text: "Stopped before any function finished, so there is nothing to show.",
              tone: "muted",
            }
          : {
              text: `Not run yet. Run ${sensor.display} from the Scan panel.`,
              tone: "muted",
            },
      ],
      enabled: false,
      tooltip: "",
      outOfDate: 0,
      total: 0,
      metrics: sensor.metrics.map((metric) =>
        describe(sensor.name, metric, {}),
      ),
    });
  }

  groups.push(...built.values());

  return {
    groups,
    metrics: groups
      .filter((group) => group.enabled)
      .flatMap((group) => group.metrics),
    unreadable,
  };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function rank(value: MetricValue): number {
  return typeof value === "boolean" ? Number(value) : value;
}

export function moduleValue(
  metric: MetricDescriptor,
  moduleId: string,
): ModuleValue | null {
  if (metric.granularity === "module") {
    const value = metric.values[moduleId];

    return value === undefined ? null : { value, member: null };
  }

  const prefix = `${moduleId}::`;
  let worst: ModuleValue | null = null;
  let worstId = "";
  const ids = Object.keys(metric.values)
    .filter((id) => id.startsWith(prefix))
    .sort(compare);

  for (const id of ids) {
    const value = metric.values[id] as MetricValue;
    const better =
      worst === null ||
      (metric.bad === "high"
        ? rank(value) > rank(worst.value)
        : rank(value) < rank(worst.value));

    if (better) {
      worst = { value, member: id.slice(prefix.length) };
      worstId = id;
    }
  }

  return worstId === "" ? null : worst;
}

export function pruneTicks(
  ticks: readonly string[],
  metrics: readonly MetricDescriptor[],
): string[] {
  const live = new Set(metrics.map((metric) => metric.key));

  return ticks.filter((key) => live.has(key));
}

export function currentMetricNamed(
  name: string | undefined,
  metrics: readonly MetricDescriptor[],
): MetricDescriptor | null {
  if (name === undefined) {
    return null;
  }

  return metrics.find((metric) => metric.label === name) ?? null;
}
