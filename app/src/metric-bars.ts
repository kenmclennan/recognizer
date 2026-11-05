import type {
  MetricDescriptor,
  MetricValue,
  ModuleValue,
} from "./overlay-model";

export const BAR_ROW = 14;
export const BAR_MIN_BOX_WIDTH = 150;
export const BAR_TRACK_HEIGHT = 6;
export const BAR_LEFT = 44;
export const BAR_BOTTOM_PAD = 6;
export const BAR_PAD = 10;

export type Tone = "green" | "amber" | "red";
export type BarRect = { x: number; y: number; width: number; height: number };

type Shape = Pick<MetricDescriptor, "type" | "max" | "bad" | "label">;

export function fraction(
  metric: Pick<Shape, "type" | "max">,
  value: MetricValue,
): number {
  if (metric.type === "boolean") {
    return value === true ? 1 : 0;
  }

  const number = value as number;

  if (metric.type === "ratio") {
    return Math.min(1, Math.max(0, number));
  }

  if (metric.max <= 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, number / metric.max));
}

export function tone(metric: Shape, value: MetricValue): Tone {
  const number = typeof value === "boolean" ? Number(value) : value;
  const scale =
    metric.type === "count" || metric.type === "number" ? metric.max : 1;

  if (scale <= 0) {
    return metric.bad === "high" ? "green" : "red";
  }

  const raw = Math.min(scale, Math.max(0, number));
  const part = metric.bad === "high" ? raw : scale - raw;

  if (part * 3 < scale) {
    return "green";
  }

  return part * 3 < scale * 2 ? "amber" : "red";
}

export function valueLabel(
  metric: Pick<Shape, "type">,
  value: MetricValue,
): string {
  if (metric.type === "boolean") {
    return value === true ? "yes" : "no";
  }

  const number = value as number;

  if (metric.type === "ratio") {
    return `${Math.round(number * 100)}%`;
  }

  if (metric.type === "count") {
    return String(Math.round(number));
  }

  return (Math.round(number * 10) / 10).toFixed(1).replace(/\.0$/, "");
}

export function rangeLabel(metric: Shape): string {
  const range =
    metric.type === "ratio"
      ? "0 to 100%"
      : metric.type === "boolean"
        ? "no or yes"
        : `0 to ${valueLabel(metric, metric.max)}`;

  return `${range}, ${metric.bad === "high" ? "high is bad" : "low is bad"}`;
}

export function barTitle(
  metric: Shape,
  found: ModuleValue | null,
  name: string = metric.label,
): string {
  if (found === null) {
    return `${name}: not measured`;
  }

  const text = `${name} ${valueLabel(metric, found.value)}`;

  return found.member === null ? text : `${text}, worst: ${found.member}`;
}

export function barRect(
  rect: BarRect,
  baseHeight: number,
  index: number,
): BarRect {
  return {
    x: rect.x + BAR_LEFT,
    y: rect.y + baseHeight + index * BAR_ROW + (BAR_ROW - BAR_TRACK_HEIGHT) / 2,
    width: Math.max(0, rect.width - BAR_LEFT - BAR_PAD - VALUE_WIDTH),
    height: BAR_TRACK_HEIGHT,
  };
}

export const VALUE_WIDTH = 34;

export function barWidth(width: number, barRows: number): number {
  return barRows > 0 ? Math.max(width, BAR_MIN_BOX_WIDTH) : width;
}

const LABEL_MAX = 4;

export function clipLabel(label: string): string {
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label;
}

export type MemberSource = { labels: string[]; member: string };

export function memberSources(
  bars: readonly { label: string; member: string | null }[],
): MemberSource[] | null {
  const sources = new Map<string, string[]>();

  for (const { label, member } of bars) {
    if (member !== null) {
      sources.set(member, [...(sources.get(member) ?? []), label]);
    }
  }

  if (sources.size < 2) {
    return null;
  }

  return [...sources].map(([member, labels]) => ({ labels, member }));
}

export function sourceTitle(sources: readonly MemberSource[]): string {
  return sources
    .map(({ labels, member }) => `${labels.join(", ")}: ${member}`)
    .join("\n");
}

export function sourceLabel(sources: readonly MemberSource[]): string {
  return `from ${sources.length} functions`;
}
