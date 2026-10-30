import type { Scan } from "recognizer";
import { describe, expect, it } from "vitest";
import { buildCanvasGraph } from "./canvas-graph";
import { expectedScan } from "./fixtures";
import { createPicker, LONG_LIST, type PickerSource } from "./picker-model";

type EdgeSpec = {
  from: string;
  to: string;
  names?: string[];
  kind?: "depends" | "inherits" | "implements";
  to_member?: string;
  inferred?: boolean;
};

function scanOf(
  ids: string[],
  edges: EdgeSpec[],
  members: Record<string, { name: string; exported: boolean }[]> = {},
): Scan {
  return {
    modules: ids.map((id) => ({
      id,
      kind: "module" as const,
      ...(members[id] ? { members: members[id] } : {}),
    })),
    edges: edges.map((edge, index) => ({
      from: edge.from,
      to: edge.to,
      kind: edge.kind ?? ("depends" as const),
      line: index + 1,
      ...(edge.names ? { names: edge.names } : {}),
      ...(edge.to_member ? { to_member: edge.to_member } : {}),
      ...(edge.inferred
        ? {
            inferred: {
              parameter: "p",
              methods: edge.names ?? [],
              class: "Cls",
              implementations: [],
            },
          }
        : {}),
    })),
    foreign: [],
  } as unknown as Scan;
}

function pickerOf(
  scan: Scan,
  source: PickerSource,
  onCanvas: (id: string) => boolean = () => false,
  extra: { filter?: string; collapsed?: Set<string> } = {},
) {
  return createPicker({
    scans: [scan],
    modules: scan.modules.map((module) => module.id),
    onCanvas,
    source,
    filter: extra.filter ?? "",
    collapsed: extra.collapsed ?? new Set(),
  });
}

const star = scanOf(
  ["hub.py", "a/x.py", "a/y.py", "b/z.py", "top.py"],
  [
    { from: "hub.py", to: "a/x.py", names: ["Beta", "Alpha"] },
    { from: "hub.py", to: "a/y.py" },
    { from: "hub.py", to: "b/z.py", names: ["zed"] },
    { from: "hub.py", to: "hub.py", names: ["self"] },
    { from: "hub.py", to: "gone.py", names: ["phantom"] },
    { from: "top.py", to: "hub.py", names: ["Hub"] },
    { from: "a/x.py", to: "hub.py", names: ["Hub", "Other"] },
  ],
  { "hub.py": [{ name: "Hub", exported: true }] },
);

const usesHub: PickerSource = {
  kind: "module",
  id: "hub.py",
  direction: "uses",
};
const usedByHub: PickerSource = {
  kind: "module",
  id: "hub.py",
  direction: "usedBy",
};

describe("picker rows", () => {
  it("lists a module's distinct known neighbours for Uses and Used by", () => {
    const uses = pickerOf(star, usesHub);
    const usedBy = pickerOf(star, usedByHub);

    expect(uses.rowCount()).toBe(3);
    expect(
      uses.groups().flatMap((group) => group.rows.map((row) => row.id)),
    ).toEqual(["a/x.py", "a/y.py", "b/z.py"]);
    expect(usedBy.rowCount()).toBe(2);
  });

  it("lists the outside modules on edges crossing a folder's boundary", () => {
    const uses = pickerOf(star, { kind: "folder", id: "a", direction: "uses" });
    const usedBy = pickerOf(star, {
      kind: "folder",
      id: "a",
      direction: "usedBy",
    });

    expect(uses.rowCount()).toBe(1);
    expect(usedBy.rowCount()).toBe(1);
    expect(usedBy.groups()[0]?.rows[0]?.id).toBe("hub.py");
  });

  it("agrees with the bar's counts", () => {
    const modules = star.modules.map((module) => module.id);
    const graph = buildCanvasGraph({
      scans: [star],
      modules,
      opened: modules,
      disc: () => "green",
      folded: new Set(),
      focus: null,
      showInferred: true,
    });

    expect(pickerOf(star, usesHub).rowCount()).toBe(
      graph.counts({ kind: "module", id: "hub.py" }).uses,
    );
    expect(pickerOf(star, usedByHub).rowCount()).toBe(
      graph.counts({ kind: "module", id: "hub.py" }).usedBy,
    );
    expect(
      pickerOf(star, {
        kind: "folder",
        id: "a",
        direction: "usedBy",
      }).rowCount(),
    ).toBe(graph.counts({ kind: "folder", id: "a" }).usedBy);
  });

  it("titles each source", () => {
    expect(pickerOf(star, usesHub).title()).toBe("hub uses 3");
    expect(pickerOf(star, usedByHub).title()).toBe("hub is used by 2");
  });
});

describe("grouping and sorting", () => {
  it("groups by folder sorted, every group headed by its full path", () => {
    const groups = pickerOf(star, usesHub).groups();

    expect(groups.map((group) => group.key)).toEqual(["a", "b"]);
    expect(groups.map((group) => group.label)).toEqual(["a/", "b/"]);
    expect(groups[0]?.rows.map((row) => row.label)).toEqual(["x", "y"]);
    expect(groups[1]?.rows[0]?.label).toBe("z");
  });

  it("names a nested folder by its whole path and a root module under ./", () => {
    const scan = scanOf(
      ["hub.py", "deep/er/m.py", "top.py"],
      [
        { from: "hub.py", to: "deep/er/m.py" },
        { from: "hub.py", to: "top.py" },
      ],
    );

    expect(
      pickerOf(scan, usesHub)
        .groups()
        .map((group) => group.label),
    ).toEqual(["./", "deep/er/"]);
  });

  it("gives a group the checkbox state of its rows on the canvas", () => {
    const state = (on: string[]) =>
      pickerOf(star, usesHub, (id) => on.includes(id))
        .groups()
        .map((group) => group.state);

    expect(state([])).toEqual(["unchecked", "unchecked"]);
    expect(state(["a/x.py"])).toEqual(["partial", "unchecked"]);
    expect(state(["a/x.py", "a/y.py", "b/z.py"])).toEqual([
      "checked",
      "checked",
    ]);
  });

  const wide = (count: number) =>
    scanOf(
      [
        "hub.py",
        ...Array.from({ length: count }, (_, i) =>
          i < count - 2 ? `big/m${i}.py` : `small/m${i}.py`,
        ),
      ],
      Array.from({ length: count }, (_, i) => ({
        from: "hub.py",
        to: i < count - 2 ? `big/m${i}.py` : `small/m${i}.py`,
      })),
    );

  it("starts fully open at exactly 18 rows", () => {
    expect(LONG_LIST).toBe(18);

    const groups = pickerOf(wide(18), usesHub).groups();

    expect(groups.map((group) => group.collapsed)).toEqual([false, false]);
  });

  it("collapses groups of more than 2 at 19 rows and leaves groups of 2 open", () => {
    const groups = pickerOf(wide(19), usesHub).groups();

    expect(groups.map((group) => [group.key, group.collapsed])).toEqual([
      ["big", true],
      ["small", false],
    ]);
  });

  it("flips a group's default collapse when its key is in the overrides, and a filter expands every group", () => {
    const flipped = pickerOf(wide(19), usesHub, () => false, {
      collapsed: new Set(["big"]),
    });

    expect(flipped.groups()[0]?.collapsed).toBe(false);
    expect(
      pickerOf(wide(19), usesHub, () => false, { filter: "m1" })
        .groups()
        .every((group) => !group.collapsed),
    ).toBe(true);
  });
});

describe("names and marks", () => {
  it("shows sorted names, four at most then +N", () => {
    const scan = scanOf(
      ["hub.py", "a.py"],
      [{ from: "hub.py", to: "a.py", names: ["e", "d", "c", "b", "a", "f"] }],
    );
    const row = pickerOf(scan, usesHub).groups()[0]?.rows[0];

    expect(row?.names).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(row?.namesText).toBe("a, b, c, d +2");
  });

  it("falls back to to_member and shows nothing for a bare module import", () => {
    const scan = scanOf(
      ["hub.py", "a.py", "b.py"],
      [
        { from: "hub.py", to: "a.py", kind: "inherits", to_member: "Base" },
        { from: "hub.py", to: "b.py" },
      ],
    );
    const rows = pickerOf(scan, usesHub)
      .groups()
      .flatMap((g) => g.rows);

    expect(rows[0]?.names).toEqual(["Base"]);
    expect(rows[1]?.names).toEqual([]);
  });

  it("marks a row private when any name's member is not exported", () => {
    const scan = scanOf(
      ["hub.py", "a.py", "b.py"],
      [
        { from: "hub.py", to: "a.py", names: ["_p", "q"] },
        { from: "hub.py", to: "b.py", names: ["q"] },
      ],
      {
        "a.py": [
          { name: "_p", exported: false },
          { name: "q", exported: true },
        ],
        "b.py": [{ name: "q", exported: true }],
      },
    );
    const rows = pickerOf(scan, usesHub)
      .groups()
      .flatMap((g) => g.rows);

    expect(rows.map((row) => row.private)).toEqual([true, false]);
  });

  it("marks a row inferred only when every edge is inferred", () => {
    const scan = scanOf(
      ["hub.py", "a.py", "b.py"],
      [
        { from: "hub.py", to: "a.py", names: ["m"], inferred: true },
        { from: "hub.py", to: "b.py", names: ["m"], inferred: true },
        { from: "hub.py", to: "b.py", names: ["n"] },
      ],
    );
    const rows = pickerOf(scan, usesHub)
      .groups()
      .flatMap((g) => g.rows);

    expect(rows.map((row) => row.inferred)).toEqual([true, false]);
  });
});

describe("filter", () => {
  const ids = (filter: string) =>
    pickerOf(star, usesHub, () => false, { filter })
      .groups()
      .flatMap((g) => g.rows.map((r) => r.id));

  it("matches module id and names, case-insensitively", () => {
    expect(ids("ALPHA")).toEqual(["a/x.py"]);
    expect(ids("b/z")).toEqual(["b/z.py"]);
  });

  it("hides the not-used-outside line while filtering", () => {
    const scan = scanOf(
      ["hub.py", "a.py"],
      [{ from: "a.py", to: "hub.py", names: ["Used"] }],
      { "hub.py": [{ name: "Idle", exported: true }] },
    );

    expect(pickerOf(scan, usedByHub).unused()).toEqual(["Idle"]);
    expect(
      pickerOf(scan, usedByHub, () => false, { filter: "a" }).unused(),
    ).toBeNull();
  });
});

describe("not used outside", () => {
  const members = {
    "hub.py": [
      { name: "Used", exported: true },
      { name: "Idle", exported: true },
      { name: "_hidden", exported: false },
      { name: "Cls", exported: true },
    ],
  };

  it("lists exported members no outside module uses", () => {
    const scan = scanOf(
      ["hub.py", "a.py"],
      [
        { from: "a.py", to: "hub.py", names: ["Used"] },
        { from: "hub.py", to: "hub.py", names: ["Idle"] },
      ],
      members,
    );

    expect(pickerOf(scan, usedByHub).unused()).toEqual(["Idle", "Cls"]);
  });

  it("counts an inferred edge's class and not its method names", () => {
    const scan = scanOf(
      ["hub.py", "a.py"],
      [{ from: "a.py", to: "hub.py", names: ["Idle"], inferred: true }],
      members,
    );

    expect(pickerOf(scan, usedByHub).unused()).toEqual(["Used", "Idle"]);
    expect(
      pickerOf(
        scanOf(
          ["hub.py", "a.py"],
          [{ from: "a.py", to: "hub.py", names: ["x"], inferred: true }],
          { "hub.py": [{ name: "Cls", exported: true }] },
        ),
        usedByHub,
      ).unused(),
    ).toBeNull();
  });

  it("yields no section without members, or when nothing is unused, or for Uses", () => {
    const bare = scanOf(["hub.py", "a.py"], [{ from: "a.py", to: "hub.py" }]);
    const all = scanOf(
      ["hub.py", "a.py"],
      [{ from: "a.py", to: "hub.py", names: ["Only"] }],
      { "hub.py": [{ name: "Only", exported: true }] },
    );

    expect(pickerOf(bare, usedByHub).unused()).toBeNull();
    expect(pickerOf(all, usedByHub).unused()).toBeNull();
    expect(pickerOf(star, usesHub).unused()).toBeNull();
  });
});

describe("the committed python fixture", () => {
  const scan = expectedScan("python");
  const fixture = (source: PickerSource) => pickerOf(scan, source);
  const ids = (model: ReturnType<typeof fixture>) =>
    model.groups().flatMap((g) => g.rows.map((r) => r.id));

  it("lists the dependents of shop/domain/order.py with their names", () => {
    const model = fixture({
      kind: "module",
      id: "shop/domain/order.py",
      direction: "usedBy",
    });

    expect(ids(model).sort()).toEqual([
      "shop/__init__.py",
      "shop/application/place.py",
      "shop/application/report.py",
      "shop/domain/__init__.py",
    ]);

    const namesOf = (id: string) =>
      model
        .groups()
        .flatMap((g) => g.rows)
        .find((row) => row.id === id)?.names;

    expect(namesOf("shop/application/report.py")).toContain("Order");
    expect(
      model
        .groups()
        .flatMap((g) => g.rows)
        .filter((row) => row.private)
        .map((row) => row.id)
        .sort(),
    ).toEqual(["shop/application/place.py", "shop/domain/__init__.py"]);
    expect(model.unused()).toBeNull();
  });

  it("lists the dependents of shop/ports/store.py by name and what is unused", () => {
    const model = fixture({
      kind: "module",
      id: "shop/ports/store.py",
      direction: "usedBy",
    });
    const rows = model.groups().flatMap((g) => g.rows);

    expect(rows.map((row) => row.id).sort()).toEqual([
      "shop/adapters/memory_store.py",
      "shop/application/place.py",
      "shop/application/refund.py",
    ]);
    expect(
      rows.find((row) => row.id === "shop/application/refund.py")?.inferred,
    ).toBe(true);
    expect(
      rows.find((row) => row.id === "shop/application/refund.py")?.names,
    ).toContain("save");
    expect(model.unused()).toEqual(["Clock"]);
  });

  it("lists a folder's dependents in two groups, no dependencies, and its files", () => {
    const usedBy = fixture({
      kind: "folder",
      id: "shop/domain",
      direction: "usedBy",
    });
    const uses = fixture({
      kind: "folder",
      id: "shop/domain",
      direction: "uses",
    });

    expect(usedBy.rowCount()).toBe(4);
    expect(usedBy.groups().map((g) => [g.key, g.count])).toEqual([
      ["shop", 1],
      ["shop/application", 3],
    ]);
    expect(uses.rowCount()).toBe(0);
  });
});
