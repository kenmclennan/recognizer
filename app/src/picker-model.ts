import {
  edgeNames,
  folderOf,
  folderUsedBy,
  folderUses,
  lastSegment,
  moduleLabel,
  type NeighbourRow,
  type Scan,
  usedByOf,
  usesOf,
} from "recognizer";
import { type CheckState, checkState } from "./row-model";

export const LONG_LIST = 18;
export const NAMES_SHOWN = 4;

export type PickerSource =
  | { kind: "module"; id: string; direction: "uses" | "usedBy" }
  | { kind: "folder"; id: string; direction: "uses" | "usedBy" }
  | { kind: "list"; items: { id: string; names?: string[] }[]; title: string };

export type PickerRow = {
  id: string;
  label: string;
  names: string[];
  namesText: string;
  private: boolean;
  inferred: boolean;
  onCanvas: boolean;
};

export type PickerGroup = {
  key: string;
  label: string;
  state: CheckState;
  collapsed: boolean;
  count: number;
  ids: string[];
  rows: PickerRow[];
};

export type PickerModel = {
  title: () => string;
  placeholder: () => string;
  groups: () => PickerGroup[];
  unused: () => string[] | null;
  rowCount: () => number;
  missing: () => number;
};

export type PickerInput = {
  scans: Scan[];
  modules: string[];
  onCanvas: (id: string) => boolean;
  source: PickerSource;
  filter: string;
  collapsed: ReadonlySet<string>;
};

type RawRow = NeighbourRow & { group: string };

export { edgeNames };

const compare = (a: string, b: string) => a.localeCompare(b);

function namesText(names: string[]): string {
  const shown = names.slice(0, NAMES_SHOWN).join(", ");

  return names.length > NAMES_SHOWN
    ? `${shown} +${names.length - NAMES_SHOWN}`
    : shown;
}

export function createPicker(input: PickerInput): PickerModel {
  const { source, onCanvas } = input;
  const known = new Set(input.modules);
  const allEdges = input.scans.flatMap((scan) => scan.edges);
  const filter = input.filter.trim().toLowerCase();
  let missing = 0;

  const withGroup = (rows: NeighbourRow[]): RawRow[] =>
    rows.map((row) => ({ ...row, group: folderOf(row.id) }));

  function buildRows(): RawRow[] {
    if (source.kind === "list") {
      const rows: RawRow[] = [];

      for (const item of source.items) {
        if (!known.has(item.id)) {
          missing += 1;

          continue;
        }

        rows.push({
          id: item.id,
          group: folderOf(item.id),
          names: item.names ?? [],
          private: false,
          inferred: false,
        });
      }

      return rows;
    }

    const uses = source.direction === "uses";

    if (source.kind === "module") {
      return withGroup(
        uses
          ? usesOf(input.scans, input.modules, source.id)
          : usedByOf(input.scans, input.modules, source.id),
      );
    }

    return withGroup(
      uses
        ? folderUses(input.scans, input.modules, source.id)
        : folderUsedBy(input.scans, input.modules, source.id),
    );
  }

  const raw = buildRows().sort((a, b) => compare(a.id, b.id));
  const defaultCollapsed = new Set<string>();

  if (raw.length > LONG_LIST) {
    const sizes = new Map<string, number>();

    for (const row of raw) {
      sizes.set(row.group, (sizes.get(row.group) ?? 0) + 1);
    }

    for (const [key, size] of sizes) {
      if (size > 2) {
        defaultCollapsed.add(key);
      }
    }
  }

  const matches = (row: RawRow) =>
    filter === "" ||
    row.id.toLowerCase().includes(filter) ||
    row.names.some((name) => name.toLowerCase().includes(filter));

  const view = (row: RawRow): PickerRow => ({
    id: row.id,
    label: moduleLabel(row.id),
    names: row.names,
    namesText: namesText(row.names),
    private: row.private,
    inferred: row.inferred,
    onCanvas: onCanvas(row.id),
  });

  const groupLabel = (key: string) => (key === "" ? "./" : `${key}/`);

  function groups(): PickerGroup[] {
    const byGroup = new Map<string, RawRow[]>();

    for (const row of raw.filter(matches)) {
      byGroup.set(row.group, [...(byGroup.get(row.group) ?? []), row]);
    }

    return [...byGroup.keys()].sort(compare).map((key) => {
      const rows = byGroup.get(key) as RawRow[];
      const ids = rows.map((row) => row.id);

      return {
        key,
        label: groupLabel(key),
        state: checkState(ids, onCanvas),
        collapsed:
          filter === "" &&
          defaultCollapsed.has(key) !== input.collapsed.has(key),
        count: rows.length,
        ids,
        rows: rows.map(view),
      };
    });
  }

  function unused(): string[] | null {
    if (source.kind !== "module" || source.direction !== "usedBy") {
      return null;
    }

    if (filter !== "") {
      return null;
    }

    const own = input.scans
      .flatMap((scan) => scan.modules)
      .find((module) => module.id === source.id);

    if (!own?.members) {
      return null;
    }

    const used = new Set<string>();

    for (const edge of allEdges) {
      if (edge.to !== source.id || edge.from === source.id) {
        continue;
      }

      if (edge.inferred) {
        used.add(edge.inferred.class);
      } else {
        for (const name of edgeNames(edge)) {
          used.add(name);
        }
      }
    }

    const result = own.members
      .filter((member) => member.exported && !used.has(member.name))
      .map((member) => member.name);

    return result.length > 0 ? result : null;
  }

  function title(): string {
    if (source.kind === "list") {
      return source.title;
    }

    const label =
      source.kind === "module"
        ? moduleLabel(source.id)
        : lastSegment(source.id);

    return source.direction === "uses"
      ? `${label} uses ${raw.length}`
      : `${label} is used by ${raw.length}`;
  }

  return {
    title,
    placeholder: () => `Filter ${raw.length} modules`,
    groups,
    unused,
    rowCount: () => raw.length,
    missing: () => missing,
  };
}
