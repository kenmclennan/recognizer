import type { Scan, ScanEdge, ScanMember } from "recognizer";
import { describe, expect, it } from "vitest";
import { expectedScan } from "./fixtures";
import {
  emphasisedLines,
  type InspectorInputs,
  inspectorContent,
  type Row,
} from "./inspector-model";

const scanOf = (
  members: ScanMember[] | undefined,
  extra: Partial<Scan> = {},
): Scan => ({
  modules: [
    {
      id: "pkg/m.py",
      kind: "module",
      ...(members === undefined ? {} : { members }),
    },
  ],
  edges: [],
  foreign: [],
  ...extra,
});

function inputsFor(
  scans: Scan[],
  extra: Partial<InspectorInputs> = {},
): InspectorInputs {
  return {
    scans,
    modules: scans.flatMap((scan) => scan.modules.map((module) => module.id)),
    disc: () => "green",
    findings: () => [],
    onCanvas: () => false,
    expanded: new Set(),
    tab: "contents",
    evidence: null,
    edgeOnCanvas: true,
    counts: () => ({ uses: 0, usedBy: 0 }),
    filter: "",
    collapsed: new Set(),
    ...extra,
  };
}

const module = (id: string) => ({ kind: "module", id }) as const;
const folder = (id: string) => ({ kind: "folder", id }) as const;

const rowsOf = (scan: Scan, extra: Partial<InspectorInputs> = {}) =>
  inspectorContent(module("pkg/m.py"), inputsFor([scan], extra)).rows;

const texts = (rows: Row[]) =>
  rows.map((row) =>
    "text" in row ? row.text : "name" in row ? row.name : row.kind,
  );

const fn = (name: string, exported: boolean, extra = {}): ScanMember => ({
  name,
  kind: "function",
  exported,
  params: [],
  ...extra,
});

describe("module contents ordering and folds", () => {
  const members: ScanMember[] = [
    { name: "_hidden", kind: "constant", exported: false, value: "1" },
    fn("_a", false),
    fn("b", true, { params: [{ name: "x" }], returns: "int" }),
    { name: "K", kind: "constant", exported: true, value: "30000" },
    { name: "Alias", kind: "type", exported: true },
  ];

  it("lists Classes, Functions, Constants and Types in that order", () => {
    const rows = rowsOf(scanOf(members));

    expect(
      rows.filter((row) => row.kind === "heading").map((row) => row.text),
    ).toEqual(["Classes", "Functions", "Constants", "Types"]);
  });

  it("leaves Types out when the module has none", () => {
    const rows = rowsOf(scanOf([fn("b", true)]));

    expect(
      rows.some((row) => row.kind === "heading" && row.text === "Types"),
    ).toBe(false);
  });

  it("shows None for an empty section", () => {
    const rows = rowsOf(scanOf([fn("b", true)]));

    expect(rows.filter((row) => row.kind === "none")).toHaveLength(2);
  });

  it("puts public members first and folds private ones into a count", () => {
    const rows = rowsOf(scanOf(members));
    const text = texts(rows);

    expect(text).toContain("b(x) → int");
    expect(text).toContain("1 private function");
    expect(text).not.toContain("_a()");
    expect(text).toContain("K = 30000");
    expect(text).toContain("1 private constant");
  });

  it("follows the exported flag, not the name", () => {
    const rows = rowsOf(
      scanOf([fn("_looks_private", true), fn("plain", false)]),
    );
    const text = texts(rows);

    expect(text).toContain("_looks_private()");
    expect(text).not.toContain("plain()");
    expect(text).toContain("1 private function");
  });

  it("opens a fold by its key and keeps it open across selections", () => {
    const scan = scanOf(members);
    const expanded = new Set(["pkg/m.py|functions"]);
    const first = texts(rowsOf(scan, { expanded }));
    const again = texts(
      inspectorContent(module("pkg/m.py"), inputsFor([scan], { expanded }))
        .rows,
    );

    expect(first).toContain("_a()");
    expect(again).toEqual(first);
  });

  it("uses plural for several private members", () => {
    const rows = rowsOf(scanOf([fn("_a", false), fn("_b", false)]));

    expect(texts(rows)).toContain("2 private functions");
  });
});

describe("signatures", () => {
  const cls: ScanMember = {
    name: "C",
    kind: "class",
    exported: true,
    bases: [],
    fields: [
      { name: "a", type: "int", line: 2, private: false },
      { name: "b", line: 3, private: false },
    ],
    methods: [
      {
        name: "plain",
        params: [{ name: "x" }, { name: "y", type: "int" }],
        returns: "int",
      },
      { name: "noReturn", params: [{ name: "x" }] },
      { name: "prop", params: [], returns: "str", tags: ["property"] },
      { name: "s", params: [], tags: ["static", "async"] },
      { name: "bare" },
      { name: "_p", params: [], private: true },
    ],
  };

  it("shows fields, signatures, property form and tags", () => {
    const rows = rowsOf(scanOf([cls]));
    const members = rows.filter((row) => row.kind === "member");

    expect(members.map((row) => (row as { text: string }).text)).toEqual([
      "a: int",
      "b",
      "plain(x, y) → int",
      "noReturn(x)",
      "prop: str",
      "s()",
      "bare",
    ]);
    expect((members[5] as { tags: string }).tags).toBe("static, async");
    expect((members[4] as { tags: string }).tags).toBe("");
  });

  it("folds private methods per class", () => {
    const rows = rowsOf(scanOf([cls]));

    expect(rows).toContainEqual(
      expect.objectContaining({
        kind: "fold",
        key: "pkg/m.py|C|methods",
        text: "1 private method",
      }),
    );
  });

  it("shows a bare name for a function with no params", () => {
    const rows = rowsOf(
      scanOf([{ name: "f", kind: "function", exported: true }]),
    );

    expect(texts(rows)).toContain("f");
    expect(texts(rows)).not.toContain("f()");
  });

  it("shows a constant without a value as its bare name", () => {
    const rows = rowsOf(
      scanOf([{ name: "K", kind: "constant", exported: true }]),
    );

    expect(texts(rows)).toContain("K");
  });
});

describe("class tags", () => {
  const classOf = (
    bases: string[],
    edges: ScanEdge[] = [],
    kind: "class" | "interface" = "class",
  ) =>
    rowsOf(
      scanOf(
        [{ name: "C", kind, exported: true, bases, fields: [], methods: [] }],
        {
          edges,
        },
      ),
    );
  const edge = (kind: ScanEdge["kind"], to_member: string): ScanEdge => ({
    from: "pkg/m.py",
    to: "pkg/o.py",
    kind,
    line: 1,
    member: "C",
    to_member,
  });

  it("shows an unresolved exception base as a tag", () => {
    const rows = classOf(["Exception"]);

    expect(rows).toContainEqual(
      expect.objectContaining({ kind: "class", tags: "Exception" }),
    );
    expect(rows.some((row) => row.kind === "base")).toBe(false);
  });

  it("adds abstract for ABC, Protocol and interfaces and drops them as bases", () => {
    for (const base of ["ABC", "Protocol"]) {
      const rows = classOf([base]);

      expect(rows).toContainEqual(
        expect.objectContaining({ kind: "class", tags: "abstract" }),
      );
      expect(rows.some((row) => row.kind === "base")).toBe(false);
    }

    expect(classOf([], [], "interface")).toContainEqual(
      expect.objectContaining({ kind: "class", tags: "abstract" }),
    );
  });

  it("drops object", () => {
    expect(classOf(["object"]).some((row) => row.kind === "base")).toBe(false);
  });

  it("shows an implements edge on its own line", () => {
    expect(classOf(["Store"], [edge("implements", "Store")])).toContainEqual(
      expect.objectContaining({ kind: "base", text: "implements Store" }),
    );
  });

  it("shows an inherits edge and an unresolved base as extends", () => {
    expect(classOf(["Base"], [edge("inherits", "Base")])).toContainEqual(
      expect.objectContaining({ kind: "base", text: "extends Base" }),
    );
    expect(classOf(["Other"])).toContainEqual(
      expect.objectContaining({ kind: "base", text: "extends Other" }),
    );
  });
});

describe("missing data", () => {
  it("says so for a module with no members", () => {
    const rows = rowsOf(scanOf(undefined));

    expect(rows).toEqual([
      {
        kind: "note",
        text: "Not known: this scan has no member outlines for this file.",
      },
    ]);
  });

  it("says so for a class with no outline keys", () => {
    const rows = rowsOf(scanOf([{ name: "C", kind: "class", exported: true }]));

    expect(rows).toContainEqual(
      expect.objectContaining({ kind: "class", tags: "outline not known" }),
    );
  });

  it("shows no callers note when the scan has no calls", () => {
    const rows = rowsOf(scanOf([fn("f", true)]));

    expect(rows[0]?.kind).toBe("heading");
    expect(
      rows.some((row) => "text" in row && /^Callers not known/.test(row.text)),
    ).toBe(false);
  });

  it("gives members no button when the scan has calls", () => {
    const scan = scanOf([fn("f", true)], {
      modules: [
        { id: "pkg/m.py", kind: "module", members: [fn("f", true)] },
        { id: "pkg/o.py", kind: "module" },
      ],
      calls: [{ from: "pkg/o.py::g", to: "pkg/m.py::f", line: 1, how: "call" }],
    });
    const rows = rowsOf(scan);

    expect(rows[0]?.kind).toBe("heading");
    expect(rows.some((row) => "button" in row)).toBe(false);
  });
});

describe("folder contents", () => {
  const scan: Scan = {
    modules: [
      {
        id: "a/x.py",
        kind: "module",
        members: [
          { name: "A", kind: "class", exported: true },
          { name: "B", kind: "class", exported: true },
          fn("f", true),
          fn("_g", false),
        ],
      },
      { id: "a/b/y.py", kind: "module" },
      { id: "a/b/z.py", kind: "module" },
      { id: "a/c.py", kind: "module" },
    ],
    edges: [],
    foreign: [],
  };

  it("lists subfolders then files with summaries and a file's canvas state", () => {
    const rows = inspectorContent(
      folder("a"),
      inputsFor([scan], { onCanvas: (id) => id === "a/x.py" }),
    ).rows;

    expect(rows).toEqual([
      {
        kind: "module",
        id: "a/b",
        ids: ["a/b/y.py", "a/b/z.py"],
        label: "b/",
        state: "unchecked",
        bold: false,
        disc: "green",
        folder: true,
        indent: false,
        chevron: null,
        detail: { text: "2 files" },
        title: "a/b",
      },
      {
        kind: "module",
        id: "a/c.py",
        ids: ["a/c.py"],
        label: "c.py",
        state: "unchecked",
        bold: false,
        disc: "green",
        folder: false,
        indent: false,
        chevron: null,
        detail: null,
        title: "a/c.py",
      },
      {
        kind: "module",
        id: "a/x.py",
        ids: ["a/x.py"],
        label: "x.py",
        state: "checked",
        bold: true,
        disc: "green",
        folder: false,
        indent: false,
        chevron: null,
        detail: { text: "2 classes, 1 function" },
        title: "a/x.py",
      },
    ]);
  });

  it("shows a subfolder partial while only some of its files are on the canvas", () => {
    const rows = inspectorContent(
      folder("a"),
      inputsFor([scan], { onCanvas: (id) => id === "a/b/y.py" }),
    ).rows;

    expect(rows[0]).toMatchObject({
      label: "b/",
      state: "partial",
      bold: true,
    });
  });

  it("headers a folder with its name and file count at any depth", () => {
    const { header } = inspectorContent(folder("a"), inputsFor([scan]));

    expect(header).toEqual({
      disc: "green",
      title: "a/",
      muted: "4 files",
      target: { kind: "folder", id: "a" },
    });
  });

  it("shows None for a folder with no known modules", () => {
    expect(inspectorContent(folder("zz"), inputsFor([scan])).rows).toEqual([
      { kind: "none" },
    ]);
  });
});

describe("header and tabs", () => {
  const scan = scanOf([fn("f", true)], {
    modules: [
      { id: "src/app/pkg/m.py", kind: "module", members: [fn("f", true)] },
    ],
  });

  it("headers a module with its name and the last two folders", () => {
    const { header } = inspectorContent(
      module("src/app/pkg/m.py"),
      inputsFor([scan]),
    );

    expect(header).toEqual({
      disc: "green",
      title: "m.py",
      muted: "app/pkg/",
      target: { kind: "module", id: "src/app/pkg/m.py" },
    });
  });

  it("shows the findings count on the tab only above zero", () => {
    const finding = { severity: "warning", text: "t", why: "w" } as const;
    const none = inspectorContent(
      module("src/app/pkg/m.py"),
      inputsFor([scan]),
    );
    const some = inspectorContent(
      module("src/app/pkg/m.py"),
      inputsFor([scan], { findings: () => [finding, finding] }),
    );

    expect(none.tabs?.map((tab) => tab.label).slice(0, 2)).toEqual([
      "Contents",
      "Findings",
    ]);
    expect(some.tabs?.map((tab) => tab.label).slice(0, 2)).toEqual([
      "Contents",
      "Findings 2",
    ]);
    expect(some.tabs?.[0]?.active).toBe(true);
  });

  it("offers Contents, Findings and Dependencies N for a module and a folder, from the counts", () => {
    const counts = () => ({ uses: 12, usedBy: 1 });
    const labels = (selection: ReturnType<typeof module | typeof folder>) =>
      inspectorContent(selection, inputsFor([scan], { counts })).tabs?.map(
        (tab) => tab.label,
      );

    expect(labels(module("src/app/pkg/m.py"))).toEqual([
      "Contents",
      "Findings",
      "Dependencies 13",
    ]);
    expect(labels(folder("src/app"))).toEqual([
      "Contents",
      "Findings",
      "Dependencies 13",
    ]);
  });

  it("has no tabs for an edge whatever tab was last chosen", () => {
    const content = inspectorContent(
      { kind: "edge", id: "e" },
      inputsFor([scan], { tab: "dependencies" }),
    );

    expect(content.tabs).toBeNull();
  });

  it("explains an empty selection", () => {
    const content = inspectorContent(null, inputsFor([scan]));

    expect(content.header.title).toBe("Inspector");
    expect(content.tabs).toBeNull();
  });
});

describe("findings", () => {
  const scan: Scan = {
    modules: [
      { id: "d/a.py", kind: "module" },
      { id: "d/sub/b.py", kind: "module" },
      { id: "d/c.py", kind: "module" },
    ],
    edges: [],
    foreign: [],
  };
  const violation = {
    severity: "violation",
    text: "v",
    why: "level 1 -> 2",
  } as const;
  const warning = { severity: "warning", text: "w", why: "no-cycles" } as const;

  it("lists violations before warnings with the why", () => {
    const rows = inspectorContent(
      module("d/a.py"),
      inputsFor([scan], {
        tab: "findings",
        findings: () => [warning, violation],
      }),
    ).rows;

    expect(rows.map((row) => (row as { text: string }).text)).toEqual([
      "v",
      "w",
    ]);
    expect(rows[0]).toMatchObject({
      why: "level 1 -> 2",
      severity: "violation",
    });
  });

  it("says No findings, or Not measured for a grey module", () => {
    const green = inspectorContent(
      module("d/a.py"),
      inputsFor([scan], { tab: "findings" }),
    ).rows;
    const grey = inspectorContent(
      module("d/a.py"),
      inputsFor([scan], { tab: "findings", disc: () => "grey" }),
    ).rows;

    expect(green).toEqual([{ kind: "note", text: "No findings" }]);
    expect(grey).toEqual([{ kind: "note", text: "Not measured" }]);
  });

  it("groups a folder's findings by file path relative to the folder", () => {
    const findings = (id: string) =>
      id === "d/sub/b.py" || id === "d/a.py" ? [violation] : [];
    const content = inspectorContent(
      folder("d"),
      inputsFor([scan], { tab: "findings", findings }),
    );

    expect(content.rows.map((row) => row.kind)).toEqual([
      "group",
      "finding",
      "group",
      "finding",
    ]);
    expect(
      content.rows.filter((row) => row.kind === "group").map((row) => row.path),
    ).toEqual(["a.py", "sub/b.py"]);
    expect(content.tabs?.[1]?.label).toBe("Findings 2");
  });

  it("notes unmeasured modules in a folder with no findings and after groups", () => {
    const grey = (id: string) => (id === "d" ? "grey" : "green");
    const quiet = inspectorContent(
      folder("d"),
      inputsFor([scan], { tab: "findings", disc: grey }),
    ).rows;
    const loud = inspectorContent(
      folder("d"),
      inputsFor([scan], {
        tab: "findings",
        disc: grey,
        findings: (id) => (id === "d/a.py" ? [violation] : []),
      }),
    ).rows;

    expect(quiet).toEqual([
      { kind: "note", text: "Some modules are not measured" },
    ]);
    expect(loud[loud.length - 1]).toEqual({
      kind: "note",
      text: "Some modules are not measured",
    });
    expect(
      inspectorContent(folder("d"), inputsFor([scan], { tab: "findings" }))
        .rows,
    ).toEqual([{ kind: "note", text: "No findings" }]);
  });
});

describe("edge", () => {
  const scan = scanOf([]);
  const sections = [
    { where: "a:1", quoted: "q", names: null, route: null, inferred: [] },
    { where: "a:2", quoted: "q", names: null, route: null, inferred: [] },
  ];
  const edge = { kind: "edge", id: "e" } as const;

  it("has no tabs and a plain header", () => {
    const content = inspectorContent(edge, inputsFor([scan]));

    expect(content.tabs).toBeNull();
    expect(content.header.title).toBe("Edge");
  });

  it("shows loading, then every section, or not on the canvas", () => {
    expect(inspectorContent(edge, inputsFor([scan])).rows).toEqual([
      { kind: "note", text: "Loading evidence" },
    ]);
    expect(
      inspectorContent(edge, inputsFor([scan], { evidence: sections })).rows,
    ).toHaveLength(2);
    expect(
      inspectorContent(edge, inputsFor([scan], { edgeOnCanvas: false })).rows,
    ).toEqual([{ kind: "note", text: "Not on the canvas." }]);
  });
});

describe("hover emphasis", () => {
  const edgeOf = (extra: Partial<ScanEdge>): ScanEdge => ({
    from: "x.py",
    to: "m.py",
    kind: "depends",
    line: 1,
    ...extra,
  });
  const line = (id: string, edge: ScanEdge) => ({
    id,
    edges: [edge],
  });

  it("emphasises names, to_member and inferred class but not other lines", () => {
    const lines = [
      line("byNames", edgeOf({ names: ["Store"] })),
      line("byMember", edgeOf({ kind: "implements", to_member: "Store" })),
      line(
        "byInferred",
        edgeOf({
          inferred: {
            parameter: "p",
            methods: ["save"],
            class: "Store",
            implementations: [],
          },
        }),
      ),
      line("other", edgeOf({ names: ["Other"] })),
      line("elsewhere", edgeOf({ to: "z.py", names: ["Store"] })),
    ];

    expect([...emphasisedLines("m.py", "Store", lines)].sort()).toEqual([
      "byInferred",
      "byMember",
      "byNames",
    ]);
  });

  it("emphasises nothing for a name no line carries", () => {
    expect(
      emphasisedLines("m.py", "Nope", [line("a", edgeOf({ names: ["X"] }))])
        .size,
    ).toBe(0);
  });
});

describe("against fixtures/python", () => {
  const scan = expectedScan("python");
  const rowsFor = (id: string, expanded: string[] = []) =>
    inspectorContent(
      module(id),
      inputsFor([scan], { expanded: new Set(expanded) }),
    ).rows;
  const hasText = (rows: Row[], text: string) =>
    rows.some((row) => "text" in row && row.text === text);

  it("shows shop/domain/order.py's Order, its fields and folded privates", () => {
    const rows = rowsFor("shop/domain/order.py");

    expect(rows).toContainEqual(
      expect.objectContaining({ kind: "class", name: "Order" }),
    );
    expect(hasText(rows, "id: str")).toBe(true);
    expect(hasText(rows, "items: int")).toBe(true);
    expect(hasText(rows, "total() → int")).toBe(true);
    expect(hasText(rows, "1 private method")).toBe(true);
    expect(hasText(rows, "3 private functions")).toBe(true);
    expect(hasText(rows, "1 private constant")).toBe(true);
  });

  it("shows new_order once the fold is open", () => {
    const rows = rowsFor("shop/domain/order.py", [
      "shop/domain/order.py|functions",
    ]);

    expect(rows).toContainEqual(
      expect.objectContaining({
        kind: "member",
        text: "new_order(order_id) → Order",
      }),
    );
  });

  it("shows Store as abstract with and Clock abstract", () => {
    const rows = rowsFor("shop/ports/store.py");

    expect(rows).toContainEqual(
      expect.objectContaining({
        kind: "class",
        name: "Store",
        tags: "abstract",
      }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        kind: "class",
        name: "Clock",
        tags: "abstract",
      }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        kind: "member",
        text: "save(order)",
        tags: "abstract",
      }),
    );
  });

  it("shows MemoryStore implements Store", () => {
    const rows = rowsFor("shop/adapters/memory_store.py");

    expect(rows).toContainEqual(
      expect.objectContaining({ kind: "base", text: "implements Store" }),
    );
  });

  it("lists the 4 files under shop/domain with no subfolders", () => {
    const rows = inspectorContent(
      folder("shop/domain"),
      inputsFor([scan]),
    ).rows;

    const modules = rows.filter((row) => row.kind === "module");

    expect(modules).toHaveLength(4);
    expect(modules.some((row) => row.folder)).toBe(false);
  });

  it("emphasises the implements and names lines into the store on hover", () => {
    const lines = scan.edges
      .filter((edge) => edge.to === "shop/ports/store.py")
      .map((edge, index) => ({ id: `l${index}`, edges: [edge] }));
    const lit = emphasisedLines("shop/ports/store.py", "Store", lines);

    expect(lit.size).toBeGreaterThan(0);
    expect(
      lines
        .filter((candidate) => lit.has(candidate.id))
        .every((candidate) =>
          candidate.edges.every(
            (edge) =>
              edge.names?.includes("Store") ||
              edge.to_member === "Store" ||
              edge.inferred?.class === "Store",
          ),
        ),
    ).toBe(true);
  });
});

describe("dependencies tab", () => {
  const edge = (from: string, to: string, names: string[]): ScanEdge => ({
    from,
    to,
    kind: "depends",
    line: 1,
    names,
  });
  const scan: Scan = {
    modules: ["hub.py", "a/x.py", "a/y.py", "b/z.py", "caller.py"].map(
      (id) => ({ id, kind: "module" }) as Scan["modules"][number],
    ),
    edges: [
      edge("hub.py", "a/x.py", ["X"]),
      edge("hub.py", "a/y.py", ["Y"]),
      edge("hub.py", "b/z.py", ["Z"]),
      edge("caller.py", "hub.py", ["Hub"]),
    ],
    foreign: [],
  };
  const open =
    (...ids: string[]) =>
    (id: string) =>
      ids.includes(id);
  const rows = (extra: Partial<InspectorInputs>) =>
    inspectorContent(
      module("hub.py"),
      inputsFor([scan], {
        tab: "dependencies",
        counts: () => ({ uses: 3, usedBy: 1 }),
        ...extra,
      }),
    ).rows;
  const moduleRows = (list: Row[]) =>
    list.filter((row) => row.kind === "module");
  const section = (list: Row[], text: string) => {
    const start = list.findIndex(
      (row) => row.kind === "fold" && row.text === text,
    );
    const after = list.slice(start + 1).findIndex((row) => row.kind === "fold");

    return list.slice(start + 1, after < 0 ? undefined : start + 1 + after);
  };

  it("has the tab Dependencies N with N the sum of the two counts", () => {
    const content = inspectorContent(
      module("hub.py"),
      inputsFor([scan], { counts: () => ({ uses: 3, usedBy: 1 }) }),
    );

    expect(content.tabs?.map((tab) => tab.label)).toEqual([
      "Contents",
      "Findings",
      "Dependencies 4",
    ]);
  });

  it("lists the filter, the Uses header and rows, then the Used by header and rows", () => {
    const list = rows({});

    expect(list[0]).toMatchObject({ kind: "filter" });
    expect(
      list
        .filter((row) => row.kind === "fold")
        .map((row) => [row.text, row.open, row.key]),
    ).toEqual([
      ["Uses 3", true, "dependencies:uses"],
      ["Used by 1", true, "dependencies:usedBy"],
    ]);
    expect(list[1]).toMatchObject({ kind: "fold", text: "Uses 3" });
  });

  it("lists the modules a module uses under folder headings with their full path, then the module rows", () => {
    const list = moduleRows(section(rows({}), "Uses 3"));

    expect(list.map((row) => [row.folder, row.label])).toEqual([
      [true, "a/"],
      [false, "x"],
      [false, "y"],
      [true, "b/"],
      [false, "z"],
    ]);
    expect(list[0]).toMatchObject({
      chevron: { key: "a", open: true },
      detail: { text: "2" },
    });
    expect(list[1]).toMatchObject({ indent: true, detail: { text: "X" } });
  });

  it("lists the modules that use a module in the Used by section", () => {
    const list = moduleRows(section(rows({}), "Used by 1"));

    expect(list.map((row) => row.label)).toEqual(["./", "caller"]);
    expect(list[0]).toMatchObject({ id: "" });
  });

  it("starts with a filter field summing both sections and ticks rows that are on the canvas", () => {
    const list = rows({ onCanvas: open("a/x.py") });

    expect(list[0]).toMatchObject({
      kind: "filter",
      placeholder: "Filter 4 modules",
    });
    expect(moduleRows(list)[0]).toMatchObject({ state: "partial" });
    expect(moduleRows(list)[1]).toMatchObject({ state: "checked", bold: true });
  });

  it("collapses a section whose key is in expanded", () => {
    const list = rows({ expanded: new Set(["dependencies:uses"]) });

    expect(list.filter((row) => row.kind === "fold")[0]).toMatchObject({
      text: "Uses 3",
      open: false,
    });
    expect(section(list, "Uses 3")).toEqual([]);
    expect(moduleRows(section(list, "Used by 1")).length).toBe(2);
  });

  it("filters both sections by module and by name", () => {
    const list = rows({ filter: "z" });

    expect(moduleRows(section(list, "Uses 3")).map((row) => row.label)).toEqual(
      ["b/", "z"],
    );
    expect(section(list, "Used by 1")).toEqual([
      { kind: "note", text: "Nothing matches." },
    ]);
    expect(
      moduleRows(section(rows({ filter: "hub" }), "Used by 1")).map(
        (row) => row.label,
      ),
    ).toEqual(["./", "caller"]);
  });

  it("shows None for an empty section", () => {
    const list = inspectorContent(
      module("a/y.py"),
      inputsFor([scan], {
        tab: "dependencies",
        counts: () => ({ uses: 0, usedBy: 1 }),
      }),
    ).rows;

    expect(section(list, "Uses 0")).toEqual([{ kind: "none" }]);
  });

  it("collapses a group whose override flips the default", () => {
    const list = moduleRows(
      section(rows({ collapsed: new Set(["a"]) }), "Uses 3"),
    );

    expect(list.map((row) => row.label)).toEqual(["a/", "b/", "z"]);
    expect(list[0]).toMatchObject({ chevron: { key: "a", open: false } });
  });

  it("always lists the full Used by set", () => {
    const content = inspectorContent(
      module("hub.py"),
      inputsFor([scan], {
        tab: "dependencies",
        counts: () => ({ uses: 3, usedBy: 7 }),
      }),
    );
    const usedBy = section(content.rows, "Used by 7");

    expect(content.tabs?.[2]?.label).toBe("Dependencies 10");
    expect(usedBy.some((row) => row.kind === "heading")).toBe(false);
  });
});
