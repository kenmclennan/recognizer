import type { Scan, ScanEdge } from "recognizer";
import { lastSegment, moduleLabel, under } from "./canvas-graph";

export const LONG_LIST = 18;
export const NAMES_SHOWN = 4;
export const NO_NAMES = "no names";

export type PickerSource =
  | { kind: "module"; id: string; direction: "uses" | "usedBy" }
  | { kind: "folder"; id: string; direction: "uses" | "usedBy" }
  | { kind: "files"; id: string }
  | { kind: "list"; items: { id: string; names?: string[] }[]; title: string };

export type PickerTab = "module" | "name";

export type PickerRow = {
  id: string;
  label: string;
  names: string[];
  namesText: string;
  private: boolean;
  inferred: boolean;
  onCanvas: boolean;
  ticked: boolean;
};

export type PickerGroup = {
  key: string;
  label: string;
  header: boolean;
  collapsed: boolean;
  count: number;
  allTicked: boolean;
  selectable: boolean;
  rows: PickerRow[];
};

export type NameGroup = { name: string; none: boolean; rows: PickerRow[] };

export type PickerFooter = {
  status: string;
  missing: string | null;
  tickAll: number | null;
  add: number;
};

export type PickerModel = {
  title: () => string;
  placeholder: () => string;
  tabs: () => PickerTab[];
  tab: () => PickerTab;
  setTab: (tab: PickerTab) => void;
  filter: () => string;
  setFilter: (text: string) => void;
  groups: () => PickerGroup[];
  nameGroups: () => NameGroup[];
  unused: () => string[] | null;
  rowCount: () => number;
  toggle: (id: string) => void;
  toggleGroup: (key: string) => void;
  toggleCollapse: (key: string) => void;
  tickAll: () => void;
  ticked: () => Set<string>;
  footer: () => PickerFooter;
};

export type PickerInput = {
  scans: Scan[];
  modules: string[];
  onCanvas: (id: string) => boolean;
  source: PickerSource;
};

type RawRow = {
  id: string;
  group: string;
  edges: ScanEdge[];
  names: string[];
  nameKeys: string[];
  private: boolean;
  inferred: boolean;
};

const folderOf = (id: string) => id.slice(0, Math.max(0, id.lastIndexOf("/")));
const compare = (a: string, b: string) => a.localeCompare(b);

export function edgeNames(edge: ScanEdge): string[] {
  if (edge.names && edge.names.length > 0) {
    return edge.names;
  }

  return edge.to_member === undefined ? [] : [edge.to_member];
}

function plainLabel(id: string): string {
  const parts = id.split("/");
  const tail = parts.slice(-2);

  tail[tail.length - 1] = moduleLabel(tail[tail.length - 1] as string);

  return tail.join("/");
}

function namesText(names: string[]): string {
  const shown = names.slice(0, NAMES_SHOWN).join(", ");

  return names.length > NAMES_SHOWN
    ? `${shown} +${names.length - NAMES_SHOWN}`
    : shown;
}

function membersOf(scans: Scan[]): Map<string, Map<string, boolean>> {
  const members = new Map<string, Map<string, boolean>>();

  for (const scan of scans) {
    for (const module of scan.modules) {
      if (module.members) {
        members.set(
          module.id,
          new Map(module.members.map((m) => [m.name, m.exported])),
        );
      }
    }
  }

  return members;
}

export function createPicker(input: PickerInput): PickerModel {
  const { source, onCanvas } = input;
  const known = new Set(input.modules);
  const members = membersOf(input.scans);
  const allEdges = input.scans.flatMap((scan) => scan.edges);
  let missing = 0;

  const isPrivate = (edge: ScanEdge, name: string) =>
    members.get(edge.to)?.get(name) === false;

  function fromEdges(
    pick: (edge: ScanEdge) => string | null,
    qualify: boolean,
  ): RawRow[] {
    const byId = new Map<string, ScanEdge[]>();

    for (const edge of allEdges) {
      if (
        edge.from === edge.to ||
        !known.has(edge.from) ||
        !known.has(edge.to)
      ) {
        continue;
      }

      const id = pick(edge);

      if (id !== null) {
        byId.set(id, [...(byId.get(id) ?? []), edge]);
      }
    }

    return [...byId.entries()].map(([id, edges]) => {
      const names = new Set<string>();
      const nameKeys = new Set<string>();
      let isPriv = false;

      for (const edge of edges) {
        for (const name of edgeNames(edge)) {
          names.add(name);
          nameKeys.add(qualify ? `${moduleLabel(edge.to)}.${name}` : name);
          isPriv = isPriv || isPrivate(edge, name);
        }
      }

      return {
        id,
        group: folderOf(id),
        edges,
        names: [...names].sort(compare),
        nameKeys: [...nameKeys],
        private: isPriv,
        inferred: edges.every((edge) => edge.inferred !== undefined),
      };
    });
  }

  function buildRows(): RawRow[] {
    if (source.kind === "files") {
      return input.modules
        .filter((id) => under(id, source.id))
        .map((id) => {
          const dir = folderOf(id);

          return {
            id,
            group: dir === source.id ? "" : dir.slice(source.id.length + 1),
            edges: [],
            names: [],
            nameKeys: [],
            private: false,
            inferred: false,
          };
        });
    }

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
          edges: [],
          names: item.names ?? [],
          nameKeys: [],
          private: false,
          inferred: false,
        });
      }

      return rows;
    }

    const uses = source.direction === "uses";

    if (source.kind === "module") {
      return fromEdges(
        (edge) =>
          uses
            ? edge.from === source.id
              ? edge.to
              : null
            : edge.to === source.id
              ? edge.from
              : null,
        false,
      );
    }

    return fromEdges((edge) => {
      const fromIn = under(edge.from, source.id);
      const toIn = under(edge.to, source.id);

      if (fromIn === toIn) {
        return null;
      }

      return uses ? (fromIn ? edge.to : null) : toIn ? edge.from : null;
    }, !uses);
  }

  const raw = buildRows().sort((a, b) => compare(a.id, b.id));
  const byId = new Map(raw.map((row) => [row.id, row]));
  const ticks = new Set<string>(
    source.kind === "list" ? raw.map((row) => row.id) : [],
  );
  const collapsedGroups = new Set<string>();
  let tab: PickerTab = "module";
  let filter = "";

  const hasNameTab = source.kind !== "files" && source.kind !== "list";

  if (raw.length > LONG_LIST) {
    const sizes = new Map<string, number>();

    for (const row of raw) {
      sizes.set(row.group, (sizes.get(row.group) ?? 0) + 1);
    }

    for (const [key, size] of sizes) {
      if (size > 2) {
        collapsedGroups.add(key);
      }
    }
  }

  const matches = (row: RawRow) =>
    filter === "" ||
    row.id.toLowerCase().includes(filter) ||
    row.names.some((name) => name.toLowerCase().includes(filter));

  const view = (row: RawRow, indent: boolean, withNames = true): PickerRow => {
    const on = onCanvas(row.id);
    const names = withNames ? row.names : [];

    return {
      id: row.id,
      label: indent ? moduleLabel(row.id) : plainLabel(row.id),
      names,
      namesText: namesText(names),
      private: withNames && row.private,
      inferred: withNames && row.inferred,
      onCanvas: on,
      ticked: on || ticks.has(row.id),
    };
  };

  const free = () => raw.filter((row) => !onCanvas(row.id));

  function groupLabel(key: string): string {
    if (source.kind === "files") {
      return key === "" ? `${lastSegment(source.id)}/` : `${key}/`;
    }

    return `${key.split("/").slice(-2).join("/")}/`;
  }

  function groups(): PickerGroup[] {
    const shown = raw.filter(matches);
    const byGroup = new Map<string, RawRow[]>();

    for (const row of shown) {
      byGroup.set(row.group, [...(byGroup.get(row.group) ?? []), row]);
    }

    return [...byGroup.keys()].sort(compare).map((key) => {
      const rows = byGroup.get(key) as RawRow[];
      const header = source.kind === "files" || rows.length > 1;
      const selectable = raw
        .filter((row) => row.group === key && !onCanvas(row.id))
        .map((row) => row.id);

      return {
        key,
        label: groupLabel(key),
        header,
        collapsed: header && filter === "" && collapsedGroups.has(key),
        count: rows.length,
        allTicked:
          selectable.length > 0 && selectable.every((id) => ticks.has(id)),
        selectable: selectable.length > 0,
        rows: rows.map((row) => view(row, header)),
      };
    });
  }

  function nameGroups(): NameGroup[] {
    const keyed = new Map<string, RawRow[]>();

    for (const row of raw) {
      const keys = row.nameKeys.length > 0 ? row.nameKeys : [NO_NAMES];

      for (const key of keys) {
        keyed.set(key, [...(keyed.get(key) ?? []), row]);
      }
    }

    const sizeOf = (key: string) => (keyed.get(key) as RawRow[]).length;
    const ordered = [...keyed.keys()].sort(
      (a, b) =>
        Number(a === NO_NAMES) - Number(b === NO_NAMES) ||
        sizeOf(b) - sizeOf(a) ||
        compare(a, b),
    );

    return ordered.flatMap((key) => {
      const rows = (keyed.get(key) as RawRow[]).filter(
        (row) =>
          filter === "" ||
          key.toLowerCase().includes(filter) ||
          row.id.toLowerCase().includes(filter),
      );

      return rows.length === 0
        ? []
        : [
            {
              name: key,
              none: key === NO_NAMES,
              rows: rows.map((row) => view(row, true, false)),
            },
          ];
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

  function ticked(): Set<string> {
    return new Set([...ticks].filter((id) => !onCanvas(id)));
  }

  function title(): string {
    if (source.kind === "list") {
      return source.title;
    }

    const label =
      source.kind === "module"
        ? moduleLabel(source.id)
        : lastSegment(source.id);

    if (source.kind === "files") {
      return `${label} holds ${raw.length} files`;
    }

    return source.direction === "uses"
      ? `${label} uses ${raw.length}`
      : `${label} is used by ${raw.length}`;
  }

  function footer(): PickerFooter {
    const picked = ticked().size;
    const available = free();
    const onCount = raw.length - available.length;

    return {
      status:
        picked > 0
          ? `${picked} picked, shown as ghosts`
          : `${onCount} already on the canvas`,
      missing: missing > 0 ? `${missing} not in the scan` : null,
      tickAll:
        available.length > 0 && picked < available.length
          ? available.length
          : null,
      add: picked,
    };
  }

  return {
    title,
    placeholder: () =>
      `Filter ${raw.length} ${tab === "name" ? "names or modules" : "modules"}`,
    tabs: () => (hasNameTab ? ["module", "name"] : []),
    tab: () => tab,
    setTab(next) {
      tab = hasNameTab ? next : "module";
    },
    filter: () => filter,
    setFilter(text) {
      filter = text.trim().toLowerCase();
    },
    groups,
    nameGroups,
    unused,
    rowCount: () => raw.length,
    toggle(id) {
      if (!byId.has(id) || onCanvas(id)) {
        return;
      }

      if (!ticks.delete(id)) {
        ticks.add(id);
      }
    },
    toggleGroup(key) {
      const ids = raw
        .filter((row) => row.group === key && !onCanvas(row.id))
        .map((row) => row.id);
      const all = ids.length > 0 && ids.every((id) => ticks.has(id));

      for (const id of ids) {
        if (all) {
          ticks.delete(id);
        } else {
          ticks.add(id);
        }
      }
    },
    toggleCollapse(key) {
      if (!collapsedGroups.delete(key)) {
        collapsedGroups.add(key);
      }
    },
    tickAll() {
      for (const row of free()) {
        ticks.add(row.id);
      }
    },
    ticked,
    footer,
  };
}
