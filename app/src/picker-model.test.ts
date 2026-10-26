import type { Scan } from "recognizer";
import { describe, expect, it } from "vitest";
import { buildCanvasGraph } from "./canvas-graph";
import { expectedScan } from "./fixtures";
import {
  createPicker,
  LONG_LIST,
  NO_NAMES,
  type PickerSource,
} from "./picker-model";

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
) {
  return createPicker({
    scans: [scan],
    modules: scan.modules.map((module) => module.id),
    onCanvas,
    source,
  });
}

const star = scanOf(
  ["hub.py", "a/x.py", "a/y.py", "b/z.py", "top.py"],
  [
    { from: "hub.py", to: "a/x.py", names: ["Beta", "Alpha"] },
    { from: "hub.py", to: "a/y.py" },
    { from: "hub.py", to: "b/z.py", names: ["zed"] },
    { from: "hub.py", to: "hub.py", names: ["self"] },
    { from: "hub.py", to: "gone.py", names: ["ghost"] },
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

  it("lists the known modules under a folder for Files, with headers per subfolder", () => {
    const scan = scanOf(["f/a.py", "f/s/b.py", "f/s/c.py", "g/d.py"], []);
    const files = pickerOf(scan, { kind: "files", id: "f" });
    const groups = files.groups();

    expect(files.rowCount()).toBe(3);
    expect(groups.map((group) => group.label)).toEqual(["f/", "s/"]);
    expect(groups.every((group) => group.header)).toBe(true);
    expect(groups[0]?.rows[0]?.names).toEqual([]);
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
      ghosts: new Set(),
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
    expect(pickerOf(star, { kind: "files", id: "a" }).title()).toBe(
      "a holds 2 files",
    );
    expect(
      pickerOf(star, {
        kind: "list",
        items: [{ id: "hub.py" }],
        title: "calls save",
      }).title(),
    ).toBe("calls save");
  });
});

describe("grouping and sorting", () => {
  it("groups by folder sorted, shows a group of one as a plain row", () => {
    const groups = pickerOf(star, usesHub).groups();

    expect(groups.map((group) => group.key)).toEqual(["a", "b"]);
    expect(groups.map((group) => group.header)).toEqual([true, false]);
    expect(groups[0]?.rows.map((row) => row.label)).toEqual(["x", "y"]);
    expect(groups[1]?.rows[0]?.label).toBe("b/z");
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

  it("toggles collapse, and a filter expands every group with a match", () => {
    const model = pickerOf(wide(19), usesHub);

    model.toggleCollapse("big");
    expect(model.groups()[0]?.collapsed).toBe(false);
    model.toggleCollapse("big");
    expect(model.groups()[0]?.collapsed).toBe(true);
    model.setFilter("m1");
    expect(model.groups().every((group) => !group.collapsed)).toBe(true);
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
  it("matches module id and names, case-insensitively", () => {
    const model = pickerOf(star, usesHub);

    model.setFilter("ALPHA");
    expect(model.groups().flatMap((g) => g.rows.map((r) => r.id))).toEqual([
      "a/x.py",
    ]);
    model.setFilter("b/z");
    expect(model.groups().flatMap((g) => g.rows.map((r) => r.id))).toEqual([
      "b/z.py",
    ]);
  });

  it("keeps ticks across a filter change and ignores it for Tick all and a group tick", () => {
    const model = pickerOf(star, usesHub);

    model.toggle("b/z.py");
    model.setFilter("alpha");
    expect([...model.ticked()]).toEqual(["b/z.py"]);
    model.toggleGroup("a");
    expect([...model.ticked()].sort()).toEqual(["a/x.py", "a/y.py", "b/z.py"]);
    model.toggleGroup("a");
    model.tickAll();
    expect(model.ticked().size).toBe(3);
  });
});

describe("by name", () => {
  const scan = scanOf(
    ["hub.py", "a.py", "b.py", "c.py", "d.py"],
    [
      { from: "a.py", to: "hub.py", names: ["Zed", "Common"] },
      { from: "b.py", to: "hub.py", names: ["Common", "Alpha"] },
      { from: "c.py", to: "hub.py" },
      { from: "d.py", to: "hub.py", names: ["Alpha"] },
    ],
  );

  it("orders by most rows, ties by locale, a row under every name it carries, no names last", () => {
    const model = pickerOf(scan, usedByHub);
    const groups = model.nameGroups();

    expect(groups.map((g) => [g.name, g.rows.map((r) => r.id)])).toEqual([
      ["Alpha", ["b.py", "d.py"]],
      ["Common", ["a.py", "b.py"]],
      ["Zed", ["a.py"]],
      [NO_NAMES, ["c.py"]],
    ]);
    expect(groups[3]?.none).toBe(true);
    expect(groups[0]?.rows[0]?.names).toEqual([]);
  });

  it("qualifies names with the owning module for a folder's Used by only", () => {
    const folderScan = scanOf(
      ["f/p.py", "f/q.py", "out.py"],
      [
        { from: "out.py", to: "f/p.py", names: ["Thing"] },
        { from: "out.py", to: "f/q.py", names: ["Thing"] },
      ],
    );
    const usedBy = pickerOf(folderScan, {
      kind: "folder",
      id: "f",
      direction: "usedBy",
    });
    const uses = pickerOf(
      scanOf(
        ["f/p.py", "out.py"],
        [{ from: "f/p.py", to: "out.py", names: ["T"] }],
      ),
      { kind: "folder", id: "f", direction: "uses" },
    );

    expect(usedBy.nameGroups().map((g) => g.name)).toEqual([
      "p.Thing",
      "q.Thing",
    ]);
    expect(uses.nameGroups().map((g) => g.name)).toEqual(["T"]);
  });

  it("is not offered for Files or an explicit list", () => {
    expect(pickerOf(scan, usedByHub).tabs()).toEqual(["module", "name"]);
    expect(pickerOf(scan, { kind: "files", id: "x" }).tabs()).toEqual([]);
    expect(
      pickerOf(scan, { kind: "list", items: [], title: "t" }).tabs(),
    ).toEqual([]);
  });

  it("ticking under any name ticks the module everywhere", () => {
    const model = pickerOf(scan, usedByHub);

    model.setTab("name");
    model.toggle("b.py");

    const ticked = model
      .nameGroups()
      .flatMap((g) => g.rows.filter((r) => r.ticked).map((r) => r.id));

    expect(ticked).toEqual(["b.py", "b.py"]);
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

describe("ticked set and footer", () => {
  it("ignores toggling an on-canvas row or an unknown id", () => {
    const model = pickerOf(star, usesHub, (id) => id === "a/x.py");

    model.toggle("a/x.py");
    model.toggle("nope.py");
    expect(model.ticked().size).toBe(0);
    expect(
      model.groups()[0]?.rows.find((row) => row.id === "a/x.py"),
    ).toMatchObject({ onCanvas: true, ticked: true });
  });

  it("stops counting a ticked row once it goes on the canvas", () => {
    const open = new Set<string>();
    const model = pickerOf(star, usesHub, (id) => open.has(id));

    model.toggle("a/x.py");
    expect([...model.ticked()]).toEqual(["a/x.py"]);
    open.add("a/x.py");
    expect(model.ticked().size).toBe(0);
  });

  it("reports picked, or the on-canvas count, with Tick all and Add", () => {
    const model = pickerOf(star, usesHub, (id) => id === "a/x.py");

    expect(model.footer()).toEqual({
      status: "1 already on the canvas",
      missing: null,
      tickAll: 2,
      add: 0,
    });
    model.toggle("a/y.py");
    expect(model.footer()).toMatchObject({
      status: "1 picked, shown as ghosts",
      tickAll: 2,
      add: 1,
    });
    model.tickAll();
    expect(model.footer()).toMatchObject({
      status: "2 picked, shown as ghosts",
      tickAll: null,
      add: 2,
    });
  });

  it("a group tick unticks when every free row is already ticked", () => {
    const model = pickerOf(star, usesHub);

    model.toggleGroup("a");
    expect(model.ticked().size).toBe(2);
    expect(model.groups()[0]?.allTicked).toBe(true);
    model.toggleGroup("a");
    expect(model.ticked().size).toBe(0);
  });
});

describe("explicit list", () => {
  it("ticks the known ids except those on the canvas and reports the rest as missing", () => {
    const model = pickerOf(
      star,
      {
        kind: "list",
        items: [
          { id: "a/x.py", names: ["save"] },
          { id: "b/z.py" },
          { id: "unknown.py" },
        ],
        title: "calls save",
      },
      (id) => id === "b/z.py",
    );

    expect([...model.ticked()]).toEqual(["a/x.py"]);
    expect(model.rowCount()).toBe(2);
    expect(model.groups().flatMap((g) => g.rows)[0]?.names).toEqual(["save"]);
    expect(model.footer().missing).toBe("1 not in the scan");
  });

  it("handles an all-known and a none-known list", () => {
    const all = pickerOf(star, {
      kind: "list",
      items: [{ id: "a/x.py" }, { id: "a/y.py" }],
      title: "t",
    });
    const none = pickerOf(star, {
      kind: "list",
      items: [{ id: "q.py" }, { id: "r.py" }],
      title: "t",
    });

    expect(all.footer().missing).toBeNull();
    expect(all.ticked().size).toBe(2);
    expect(none.rowCount()).toBe(0);
    expect(none.groups()).toEqual([]);
    expect(none.footer().missing).toBe("2 not in the scan");
    expect(none.footer().add).toBe(0);
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

    const names = new Map(
      model.nameGroups().map((g) => [g.name, g.rows.length]),
    );

    expect(names.get("Order")).toBe(4);
    expect(names.get("new_order")).toBe(2);
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
    expect(model.nameGroups().map((g) => [g.name, g.rows[0]?.id])).toEqual([
      ["save", "shop/application/refund.py"],
      ["Store", "shop/adapters/memory_store.py"],
      [NO_NAMES, "shop/application/place.py"],
    ]);
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
    const files = fixture({ kind: "files", id: "shop/domain" });

    expect(usedBy.rowCount()).toBe(4);
    expect(usedBy.groups().map((g) => [g.key, g.count])).toEqual([
      ["shop", 1],
      ["shop/application", 3],
    ]);
    expect(uses.rowCount()).toBe(0);
    expect(files.rowCount()).toBe(4);
    expect(files.groups()).toHaveLength(1);
  });
});
