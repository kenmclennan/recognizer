import { type FindingEntry, matchKind, type Sentence } from "recognizer";
import type { ShippedSensors } from "./sensor-run";

export type CatalogGroup = {
  key: string;
  name: string;
  help: { means: string; todo: string };
  sensor: string;
  pattern: string;
  sentence: Sentence;
};

export type FindingCatalog = {
  groups: CatalogGroup[];
  groupFor(kind: string): CatalogGroup | undefined;
  sensorOf(key: string): string | undefined;
};

export function groupKeyOf(pattern: string): string {
  const fixed: string[] = [];

  for (const segment of pattern.split(".")) {
    if (segment.startsWith("<")) {
      break;
    }

    fixed.push(segment);
  }

  return `kind:${fixed.join(".")}`;
}

function groupOf(sensor: string, entry: FindingEntry): CatalogGroup {
  return {
    key: groupKeyOf(entry.kind),
    name: entry.group.name,
    help: { means: entry.group.means, todo: entry.group.todo },
    sensor,
    pattern: entry.kind,
    sentence: entry.sentence,
  };
}

export function buildCatalog(shipped: ShippedSensors | null): FindingCatalog {
  const groups =
    shipped === null || shipped.status !== "ok"
      ? []
      : shipped.sensors.flatMap((sensor) =>
          sensor.findings.map((entry) => groupOf(sensor.name, entry)),
        );

  return {
    groups,
    groupFor: (kind) =>
      groups.find((group) => {
        const bindings = matchKind(group.pattern, kind);

        return (
          bindings !== null &&
          Object.values(bindings).every((value) => value !== "")
        );
      }),
    sensorOf: (key) => groups.find((group) => group.key === key)?.sensor,
  };
}

export const EMPTY_CATALOG: FindingCatalog = buildCatalog(null);
