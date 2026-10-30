import type { Scan, ScanEdge, ScanMember } from "recognizer";
import { describe, expect, it } from "vitest";
import { expectedScan } from "./fixtures";
import {
  emphasisedLines,
  followableRows,
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
    showPrivate: false,
    tab: "contents",
    evidence: null,
    edgeOnCanvas: true,
    counts: () => ({ uses: 0, usedBy: 0 }),
    filter: "",
    collapsed: new Set(),
    followed: null,
    responsibility: () => ({
      state: { kind: "missing" },
      busy: false,
      failure: null,
    }),
    ...extra,
  };
}

const module = (id: string) => ({ kind: "module", id }) as const;
const folder = (id: string) => ({ kind: "folder", id }) as const;

const rowsOf = (scan: Scan, extra: Partial<InspectorInputs> = {}) =>
  inspectorContent(module("pkg/m.py"), inputsFor([scan], extra)).rows;

const fn = (name: string, exported: boolean, extra = {}): ScanMember => ({
  name,
  kind: "function",
  exported,
  params: [],
  ...extra,
});

const cardsOf = (rows: Row[]) =>
  rows.filter(
    (row): row is Extract<Row, { kind: "card" }> => row.kind === "card",
  );

const plainText = (tokens: { text: string }[]) =>
  tokens.map((token) => token.text).join("");

const klass = (extra: Partial<ScanMember> = {}): ScanMember => ({
  name: "C",
  kind: "class",
  exported: true,
  line: 3,
  bases: [],
  fields: [
    { name: "a", type: "int", line: 4, private: false },
    { name: "_b", line: 5, private: true },
  ],
  methods: [
    {
      name: "go",
      line: 6,
      params: [{ name: "x", type: "int" }],
      returns: "int",
    },
    { name: "_h", line: 8, params: [], private: true },
  ],
  ...extra,
});

describe("module contents as cards", () => {
  it("opens with the responsibility row, then the switch, then the cards in file order across kinds", () => {
    const rows = rowsOf(
      scanOf([
        fn("f", true, { line: 11 }),
        { name: "K", kind: "constant", exported: true, value: "1", line: 2 },
        klass(),
        { name: "Alias", kind: "type", exported: true, line: 20 },
        { name: "I", kind: "interface", exported: true, line: 30 },
      ]),
    );

    expect(rows[0]).toEqual({
      kind: "responsibility",
      id: "pkg/m.py",
      state: { kind: "missing" },
      busy: false,
      failure: null,
    });
    expect(rows[1]).toEqual({
      kind: "switch",
      label: "Show private",
      on: false,
    });
    expect(cardsOf(rows).map((card) => [card.label, card.line])).toEqual([
      ["Constant", 2],
      ["Class", 3],
      ["Function", 11],
      ["Type", 20],
      ["Interface", 30],
    ]);
  });

  it("sorts a member without a line after the others, in scan order", () => {
    const cards = cardsOf(
      rowsOf(
        scanOf([fn("b", true), fn("a", true, { line: 9 }), fn("c", true)]),
      ),
    );

    expect(cards.map((card) => plainText(card.head))).toEqual([
      "a()",
      "b()",
      "c()",
    ]);
    expect(cards[1]?.line).toBeNull();
  });

  it("interleaves a class's fields and methods by line, a field first on a tie", () => {
    const card = cardsOf(
      rowsOf(
        scanOf([
          klass({
            fields: [
              { name: "late", line: 9, private: false },
              { name: "tie", line: 6, private: false },
            ],
            methods: [
              { name: "m1", line: 5, params: [] },
              { name: "m2", line: 6, params: [] },
            ],
          }),
        ]),
      ),
    )[0];

    expect(
      card?.lines.map((line) => [line.line, plainText(line.tokens)]),
    ).toEqual([
      [5, "m1()"],
      [6, "tie"],
      [6, "m2()"],
      [9, "late"],
    ]);
  });

  it("shows no trace of a hidden top-level member", () => {
    const cards = cardsOf(
      rowsOf(
        scanOf([fn("_g", false, { line: 14 }), fn("f", true, { line: 11 })]),
      ),
    );

    expect(cards).toHaveLength(1);
    expect(cards[0]?.hidden).toBe("");
  });

  it("hides private members and counts them while the switch is off", () => {
    const card = cardsOf(rowsOf(scanOf([klass()])))[0];

    expect(card?.lines.map((line) => plainText(line.tokens))).toEqual([
      "a: int",
      "go(x: int) → int",
    ]);
    expect(card?.hidden).toBe("1 private field, 1 private method hidden");
  });

  it("words the hidden count in plural and drops a zero part", () => {
    const privateFields = klass({
      fields: [
        { name: "_a", line: 4, private: true },
        { name: "_b", line: 5, private: true },
      ],
      methods: [],
    });
    const privateMethods = klass({
      fields: [],
      methods: [
        { name: "_a", line: 4, private: true },
        { name: "_b", line: 5, private: true },
      ],
    });

    expect(cardsOf(rowsOf(scanOf([privateFields])))[0]?.hidden).toBe(
      "2 private fields hidden",
    );
    expect(cardsOf(rowsOf(scanOf([privateMethods])))[0]?.hidden).toBe(
      "2 private methods hidden",
    );
  });

  it("leaves hidden empty for a class with no private member", () => {
    const card = cardsOf(
      rowsOf(
        scanOf([klass({ fields: [], methods: [{ name: "go", line: 6 }] })]),
      ),
    )[0];

    expect(card?.hidden).toBe("");
  });

  it("shows every member with the private ones marked while the switch is on", () => {
    const cards = cardsOf(
      rowsOf(
        scanOf([
          klass(),
          fn("f", true, { line: 11 }),
          fn("_g", false, { line: 14 }),
        ]),
        { showPrivate: true },
      ),
    );

    expect(cards.map((card) => [plainText(card.head), card.private])).toEqual([
      ["class C", false],
      ["f()", false],
      ["_g()", true],
    ]);
    expect(cards[0]?.lines.map((line) => [line.line, line.private])).toEqual([
      [4, false],
      [5, true],
      [6, false],
      [8, true],
    ]);
    expect(cards[0]?.hidden).toBe("");
    expect(rowsOf(scanOf([klass()]), { showPrivate: true })[1]).toEqual(
      expect.objectContaining({ kind: "switch", on: true }),
    );
  });

  it("follows the exported flag, not the name", () => {
    const cards = cardsOf(
      rowsOf(
        scanOf([
          fn("_pub", true, { line: 1 }),
          fn("plain", false, { line: 2 }),
        ]),
      ),
    );

    expect(cards.map((card) => card.hover)).toEqual(["_pub"]);
  });

  it("carries the member name as the hover of the card", () => {
    const cards = cardsOf(
      rowsOf(scanOf([klass(), fn("f", true, { line: 11 })])),
    );

    expect(cards.map((card) => card.hover)).toEqual(["C", "f"]);
  });

  it("shows None when no member is shown", () => {
    expect(rowsOf(scanOf([fn("_g", false)])).map((row) => row.kind)).toEqual([
      "responsibility",
      "switch",
      "none",
    ]);
  });

  it("produces no switch for a folder or an edge", () => {
    const folderRows = inspectorContent(
      folder("pkg"),
      inputsFor([scanOf([fn("f", true)])]),
    ).rows;
    const edgeRows = inspectorContent(
      { kind: "edge", id: "pkg/m.py>pkg/o.py" },
      inputsFor([scanOf([fn("f", true)])]),
    ).rows;

    expect(folderRows.some((row) => row.kind === "switch")).toBe(false);
    expect(edgeRows.some((row) => row.kind === "switch")).toBe(false);
    expect(folderRows.some((row) => row.kind === "responsibility")).toBe(false);
    expect(edgeRows.some((row) => row.kind === "responsibility")).toBe(false);
  });
});

describe("card tokens", () => {
  const roles = (tokens: { text: string; role: string }[]) =>
    tokens.map((token) => `${token.role}:${token.text}`);

  it("colours a typed and an untyped parameter and the return type", () => {
    const card = cardsOf(
      rowsOf(
        scanOf([
          fn("f", true, {
            line: 1,
            params: [{ name: "x", type: "int" }, { name: "y" }],
            returns: "string",
          }),
        ]),
      ),
    )[0];

    expect(roles(card?.head ?? [])).toEqual([
      "name:f",
      "plain:(",
      "param:x",
      "plain:: ",
      "type:int",
      "plain:, ",
      "param:y",
      "plain:)",
      "plain: → ",
      "keyword:string",
    ]);
  });

  it("prints a bare name for a function with no params and no return", () => {
    const card = cardsOf(
      rowsOf(scanOf([{ name: "f", kind: "function", exported: true }])),
    )[0];

    expect(roles(card?.head ?? [])).toEqual(["name:f"]);
  });

  it("prints a function with an empty parameter list as name and brackets", () => {
    const card = cardsOf(rowsOf(scanOf([fn("f", true)])))[0];

    expect(plainText(card?.head ?? [])).toBe("f()");
  });

  it("colours a field with and without a type", () => {
    const card = cardsOf(rowsOf(scanOf([klass()]), { showPrivate: true }))[0];

    expect(roles(card?.lines[0]?.tokens ?? [])).toEqual([
      "name:a",
      "plain:: ",
      "type:int",
    ]);
    expect(roles(card?.lines[1]?.tokens ?? [])).toEqual(["name:_b"]);
  });

  it("shows tags after a method as keywords and a property as name: type", () => {
    const card = cardsOf(
      rowsOf(
        scanOf([
          klass({
            fields: [],
            methods: [
              { name: "make", line: 5, params: [], tags: ["static", "async"] },
              { name: "size", line: 6, returns: "int", tags: ["property"] },
            ],
          }),
        ]),
      ),
    )[0];

    expect(plainText(card?.lines[0]?.tokens ?? [])).toBe("make() static async");
    expect(roles(card?.lines[0]?.tokens ?? []).slice(-2)).toEqual([
      "plain: ",
      "keyword:async",
    ]);
    expect(plainText(card?.lines[1]?.tokens ?? [])).toBe("size: int");
  });

  it("colours a constant with and without a value, and a type", () => {
    const cards = cardsOf(
      rowsOf(
        scanOf([
          {
            name: "K",
            kind: "constant",
            exported: true,
            value: "30000",
            line: 1,
          },
          {
            name: "N",
            kind: "constant",
            exported: true,
            value: "null",
            line: 2,
          },
          { name: "B", kind: "constant", exported: true, line: 3 },
          { name: "Alias", kind: "type", exported: true, line: 4 },
        ]),
      ),
    );

    expect(roles(cards[0]?.head ?? [])).toEqual([
      "name:K",
      "plain: = ",
      "value:30000",
    ]);
    expect(roles(cards[1]?.head ?? [])[2]).toBe("keyword:null");
    expect(roles(cards[2]?.head ?? [])).toEqual(["name:B"]);
    expect(roles(cards[3]?.head ?? [])).toEqual([
      "keyword:type",
      "plain: ",
      "name:Alias",
    ]);
  });

  it("builds a class head with its exception tag and extends", () => {
    const card = cardsOf(
      rowsOf(scanOf([klass({ bases: ["Exception", "Base"] })])),
    )[0];

    expect(roles(card?.head ?? [])).toEqual([
      "keyword:class",
      "plain: ",
      "name:C",
      "plain: ",
      "keyword:Exception",
      "plain: ",
      "keyword:extends",
      "plain: ",
      "name:Base",
    ]);
  });

  it("builds an interface head with abstract and implements from an edge", () => {
    const scan = scanOf(
      [
        {
          name: "I",
          kind: "interface",
          exported: true,
          line: 1,
          bases: ["P"],
          fields: [],
          methods: [],
        },
      ],
      {
        edges: [
          {
            from: "pkg/m.py",
            to: "pkg/p.py",
            kind: "implements",
            member: "I",
            to_member: "P",
          } as ScanEdge,
        ],
      },
    );
    const card = cardsOf(rowsOf(scan))[0];

    expect(plainText(card?.head ?? [])).toBe(
      "interface I abstract implements P",
    );
    expect(card?.label).toBe("Interface");
  });

  it("drops object and ABC as bases and adds abstract for ABC", () => {
    const card = cardsOf(
      rowsOf(scanOf([klass({ bases: ["ABC", "object"] })])),
    )[0];

    expect(plainText(card?.head ?? [])).toBe("class C abstract");
  });
});

describe("missing data", () => {
  it("says so for a module with no members", () => {
    const rows = rowsOf(scanOf(undefined));

    expect(rows.map((row) => row.kind)).toEqual(["responsibility", "note"]);
    expect(rows[1]).toEqual({
      kind: "note",
      text: "Not known: this scan has no member outlines for this file.",
    });
  });

  it("says so for a class with no outline keys", () => {
    const rows = rowsOf(scanOf([{ name: "C", kind: "class", exported: true }]));
    const card = cardsOf(rows)[0];

    expect(card?.label).toBe("Class");
    expect(plainText(card?.lines[0]?.tokens ?? [])).toBe("outline not known");
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
        follow: null,
        followed: false,
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
        follow: null,
        followed: false,
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
        follow: null,
        followed: false,
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
  const cardsFor = (id: string, showPrivate = false) =>
    cardsOf(
      inspectorContent(module(id), inputsFor([scan], { showPrivate })).rows,
    );
  const headOf = (id: string, name: string, showPrivate = false) =>
    cardsFor(id, showPrivate).find((card) => card.hover === name);

  it("shows shop/domain/order.py's Order with its fields and a hidden count", () => {
    const order = headOf("shop/domain/order.py", "Order");
    const lines = order?.lines.map((line) => plainText(line.tokens));

    expect(lines).toContain("id: str");
    expect(lines).toContain("items: int");
    expect(lines).toContain("total() → int");
    expect(order?.hidden).toMatch(/private method.* hidden$/);
    expect(
      cardsFor("shop/domain/order.py").some(
        (card) => card.label === "Function",
      ),
    ).toBe(false);
  });

  it("shows new_order once the switch is on", () => {
    const card = headOf("shop/domain/order.py", "new_order", true);

    expect(plainText(card?.head ?? [])).toBe("new_order(order_id) → Order");
  });

  it("shows Store as abstract with and Clock abstract", () => {
    const store = headOf("shop/ports/store.py", "Store");
    const clock = headOf("shop/ports/store.py", "Clock");

    expect(plainText(store?.head ?? [])).toContain("abstract");
    expect(plainText(clock?.head ?? [])).toContain("abstract");
    expect(store?.lines.map((line) => plainText(line.tokens))).toContain(
      "save(order) abstract",
    );
  });

  it("shows MemoryStore implements Store", () => {
    const card = headOf("shop/adapters/memory_store.py", "MemoryStore");

    expect(plainText(card?.head ?? [])).toContain("implements Store");
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
    expect(usedBy.some((row) => row.kind === "card")).toBe(false);
  });
});

describe("following dependency rows", () => {
  const mutual = (from: string, to: string): ScanEdge => ({
    from,
    to,
    kind: "depends",
    line: 1,
    names: ["X"],
  });
  const scan: Scan = {
    modules: ["hub.py", "a/x.py", "partner.py"].map(
      (id) => ({ id, kind: "module" }) as Scan["modules"][number],
    ),
    edges: [
      mutual("hub.py", "a/x.py"),
      mutual("hub.py", "partner.py"),
      mutual("partner.py", "hub.py"),
    ],
    foreign: [],
  };
  const dependencies = (extra: Partial<InspectorInputs> = {}) =>
    inspectorContent(
      module("hub.py"),
      inputsFor([scan], {
        tab: "dependencies",
        counts: () => ({ uses: 2, usedBy: 1 }),
        ...extra,
      }),
    ).rows;
  const moduleRows = (rows: Row[]) =>
    rows.filter(
      (row): row is Extract<Row, { kind: "module" }> => row.kind === "module",
    );

  it("makes module rows followable in the section they are listed under", () => {
    const rows = moduleRows(dependencies()).filter((row) => !row.folder);

    expect(rows.map((row) => [row.id, row.follow])).toEqual([
      ["partner.py", "uses"],
      ["a/x.py", "uses"],
      ["partner.py", "usedBy"],
    ]);
  });

  it("leaves folder headings and Contents rows unfollowable", () => {
    const headings = moduleRows(dependencies()).filter((row) => row.folder);
    const contents = inspectorContent(
      folder("a"),
      inputsFor([scan], { tab: "contents" }),
    ).rows;

    expect(headings.length).toBeGreaterThan(0);
    expect(headings.every((row) => row.follow === null)).toBe(true);
    expect(moduleRows(contents).every((row) => row.follow === null)).toBe(true);
  });

  it("highlights only the followed section when a module is in both", () => {
    const rows = moduleRows(
      dependencies({ followed: { id: "partner.py", relation: "usedBy" } }),
    ).filter((row) => row.id === "partner.py");

    expect(rows.map((row) => [row.follow, row.followed])).toEqual([
      ["uses", false],
      ["usedBy", true],
    ]);
  });

  it("highlights nothing when nothing is followed", () => {
    expect(moduleRows(dependencies()).some((row) => row.followed)).toBe(false);
  });

  it("lists followable rows in displayed order and skips collapsed groups", () => {
    expect(followableRows(dependencies())).toEqual([
      { id: "partner.py", relation: "uses" },
      { id: "a/x.py", relation: "uses" },
      { id: "partner.py", relation: "usedBy" },
    ]);
    expect(followableRows(dependencies({ collapsed: new Set(["a"]) }))).toEqual(
      [
        { id: "partner.py", relation: "uses" },
        { id: "partner.py", relation: "usedBy" },
      ],
    );
  });
});

describe("class tags from the scan", () => {
  const headOf = (members: ScanMember[], index = 0) =>
    plainText(cardsOf(rowsOf(scanOf(members)))[index]?.head ?? []);

  it("shows scan tags after the name in the scan's order", () => {
    expect(headOf([klass({ tags: ["dataclass", "frozen"] })])).toBe(
      "class C dataclass frozen",
    );
  });

  it("shows abstract once when the scan and an ABC base both give it", () => {
    expect(headOf([klass({ bases: ["ABC"], tags: ["abstract"] })])).toBe(
      "class C abstract",
    );
  });

  it("lists scan tags before exception tags", () => {
    expect(
      headOf([klass({ bases: ["Exception"], tags: ["final"] })]),
    ).toContain("class C final Exception");
  });

  it("leaves an untagged class unchanged beside a tagged one", () => {
    const members = [
      klass({ name: "A", line: 1, tags: ["dataclass"] }),
      klass({ name: "B", line: 9 }),
    ];

    expect(headOf(members, 0)).toBe("class A dataclass");
    expect(headOf(members, 1)).toBe("class B");
  });
});
