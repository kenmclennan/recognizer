import { type Overlay, validateOverlay } from "recognizer";

export type OverlayFileInput = { name: string; text: string };

export type MetricType = "ratio" | "count" | "number" | "boolean";
export type MetricValue = number | boolean;

export type MetricDescriptor = {
  key: string;
  label: string;
  description?: string;
  granularity: "module" | "member";
  type: MetricType;
  bad: "high" | "low";
  overlay: string;
  stale: boolean;
  max: number;
  values: Record<string, MetricValue>;
};

export type OverlayGroup = {
  name: string;
  heading: string;
  stale: boolean;
  metrics: MetricDescriptor[];
};

export type OverlayModel = {
  groups: OverlayGroup[];
  metrics: MetricDescriptor[];
  unreadable: string[];
};

export type ModuleValue = { value: MetricValue; member: string | null };

export const DESCRIPTIONS: Record<string, string> = {
  complexity: "Cyclomatic complexity of a function",
  coverage: "Share of a function's lines the tests ran",
  line_coverage: "Share of a module's lines the tests ran",
  crap: "Change risk: complexity weighted by missing coverage",
  mutation_survived: "Mutations of a function the tests did not catch",
};

const SHORT = 7;

function headingOf(name: string, overlay: Overlay, stale: boolean): string {
  const commit = overlay.commit.slice(0, SHORT);
  const producer = `${overlay.producer.name} ${overlay.producer.version}`;
  const freshness = stale
    ? `from ${commit}, not the scan's`
    : `at ${commit}${overlay.modified ? ", modified tree" : ""}`;

  return `${name} - ${producer} - ${freshness}`;
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

export function buildOverlayModel(
  files: readonly OverlayFileInput[],
  scan: { commit: string | null },
): OverlayModel {
  const groups: OverlayGroup[] = [];
  const unreadable: string[] = [];
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

    const stale = scan.commit === null || overlay.commit !== scan.commit;

    groups.push({
      name: file.name,
      heading: headingOf(file.name, overlay, stale),
      stale,
      metrics: overlay.metrics.map((metric) => {
        const values = overlay.values[metric.name] ?? {};
        const description = DESCRIPTIONS[metric.name];

        return {
          key: `${file.name}/${metric.name}`,
          label: metric.name,
          ...(description === undefined ? {} : { description }),
          granularity: metric.granularity,
          type: metric.type,
          bad: metric.bad,
          overlay: file.name,
          stale,
          max: largest(values),
          values,
        };
      }),
    });
  }

  return {
    groups,
    metrics: groups.flatMap((group) => group.metrics),
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
  const live = new Set(
    metrics.filter((metric) => !metric.stale).map((metric) => metric.key),
  );

  return ticks.filter((key) => live.has(key));
}

export function currentMetricNamed(
  name: string | undefined,
  metrics: readonly MetricDescriptor[],
): MetricDescriptor | null {
  if (name === undefined) {
    return null;
  }

  return (
    metrics.find((metric) => !metric.stale && metric.label === name) ?? null
  );
}

export function footerText(ticked: readonly MetricDescriptor[]): string | null {
  if (ticked.length === 0) {
    return null;
  }

  const labels = ticked.map((metric) => metric.label).join(", ");
  const overlays = [...new Set(ticked.map((metric) => metric.overlay))].join(
    ", ",
  );

  return `Showing ${labels} from ${overlays}`;
}
