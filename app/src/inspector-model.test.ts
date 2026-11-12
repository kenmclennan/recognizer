import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scan, ScanEdge, ScanMember } from "recognizer";
import { describe, expect, it } from "vitest";
import { type FindingRow, findingRows } from "./findings-order";
import {
  CURRENT,
  expectedScan,
  fixtureScan,
  secondSensorDocument,
} from "./fixtures";
import { compactFolders } from "./folder-compaction";
import { HUGE_FUNCTION, LONG_FUNCTION } from "./function-length";
import { DEFAULT_LIMITS } from "./function-limits";
import { computeHealth } from "./health";
import {
  dependencyLabels,
  emphasisedLines,
  flatRows,
  followableRows,
  type InspectorInputs,
  inspectorContent,
  type Row,
} from "./inspector-model";
import type { MetricDescriptor } from "./overlay-model";

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
  const modules = scans.flatMap((scan) =>
    scan.modules.map((module) => module.id),
  );

  return {
    scans,
    modules,
    compaction: compactFolders(modules),
    disc: () => "green",
    findings: () => [],
    findingRows: () => [],
    onCanvas: () => false,
    expanded: new Set(),
    showPrivate: false,
    tab: "contents",
    counts: () => ({ uses: 0, usedBy: 0 }),
    filter: "",
    followed: null,
    responsibility: () => ({
      state: { kind: "missing" },
      failure: null,
    }),
    metrics: [],
    metricsOn: false,
    limits: DEFAULT_LIMITS,
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

describe("module contents", () => {
  const scan = {
    modules: [{ id: "pkg/m.py", members: [] }],
    edges: [],
  } as unknown as Scan;

  it("has no note row, whether or not a view is open", () => {
    expect(rowsOf(scan)[0]?.kind).toBe("switch");
    expect(
      (rowsOf(scan) as { kind: string }[]).some(
        (row) => row.kind === "module-note",
      ),
    ).toBe(false);
  });
});

describe("module contents as cards", () => {
  it("opens with the switch, then the cards in file order across kinds", () => {
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
    expect(rowsOf(scanOf([klass()]), { showPrivate: true })[0]).toEqual(
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
      "switch",
      "none",
    ]);
  });

  it("produces no switch for a folder", () => {
    const folderRows = inspectorContent(
      folder("pkg"),
      inputsFor([scanOf([fn("f", true)])]),
    ).rows;

    expect(folderRows.some((row) => row.kind === "switch")).toBe(false);
  });
});

describe("the responsibility line in the header", () => {
  const headerOf = (
    selection: Parameters<typeof inspectorContent>[0],
    tab?: "dependencies" | "findings",
  ) =>
    inspectorContent(
      selection,
      inputsFor([scanOf([fn("f", true)])], tab ? { tab } : {}),
    ).header;

  it("is the module's line, on every tab, and never among the rows", () => {
    for (const tab of [undefined, "dependencies", "findings"] as const) {
      expect(headerOf(module("pkg/m.py"), tab).responsibility).toEqual({
        kind: "responsibility",
        id: "pkg/m.py",
        state: { kind: "missing" },
        failure: null,
      });
    }
  });

  it("is absent for a folder", () => {
    expect(headerOf(folder("pkg")).responsibility).toBeNull();
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

    expect(rows.map((row) => row.kind)).toEqual(["note"]);
    expect(rows[0]).toEqual({
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
        description: null,
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
        description: null,
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
        description: null,
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
      responsibility: null,
    });
  });

  it("headers a nested folder with its file count and parent", () => {
    const { header } = inspectorContent(folder("a/b"), inputsFor([scan]));

    expect(header.muted).toMatch(/^\d+ files · a\/$/);
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
      responsibility: {
        kind: "responsibility",
        id: "src/app/pkg/m.py",
        state: { kind: "missing" },
        failure: null,
      },
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

    expect(
      none.tabs
        ?.map((tab) => tab.label)
        .filter((l) => l.startsWith("Findings")),
    ).toEqual(["Findings"]);
    expect(
      some.tabs
        ?.map((tab) => tab.label)
        .filter((l) => l.startsWith("Findings")),
    ).toEqual(["Findings 2"]);
    expect(some.tabs?.[0]?.active).toBe(true);
  });

  it("offers Contents, Dependencies N and Findings for a module and a folder, from the counts", () => {
    const counts = () => ({ uses: 12, usedBy: 1 });
    const labels = (selection: ReturnType<typeof module | typeof folder>) =>
      inspectorContent(selection, inputsFor([scan], { counts })).tabs?.map(
        (tab) => tab.label,
      );

    expect(labels(module("src/app/pkg/m.py"))).toEqual([
      "Contents",
      "Dependencies 13",
      "Findings",
    ]);
    expect(labels(folder("src/app"))).toEqual([
      "Contents",
      "Dependencies 13",
      "Findings",
    ]);
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
  const findingRow = (
    severity: "violation" | "warning",
    summary: string,
    principle: string,
  ): FindingRow => ({
    id: `${severity}-${summary}`,
    module: "d/a.py",
    kind: "rule",
    severity,
    summary,
    principle,
    sensor: "structure",
    reported: false,
    record: {
      id: `${severity}-${summary}`,
      kind: "rule",
      severity,
      principle,
      summary,
      evidence: { modules: ["d/a.py"] },
    },
  });
  const violationRow = findingRow("violation", "v", "level 1 -> 2");
  const warningRow = findingRow("warning", "w", "no-cycles");
  const violation = {
    severity: "violation",
    text: "v",
    why: "level 1 -> 2",
  } as const;

  it("groups findings by kind in the panel's order, closed until its fold is flipped", () => {
    const rows = inspectorContent(
      module("d/a.py"),
      inputsFor([scan], {
        tab: "findings",
        findingRows: () => [warningRow, violationRow],
      }),
    ).rows;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "finding-group",
      key: "findings:kind:rule",
      open: false,
      group: { severity: "violation" },
    });
    expect(
      (rows[0] as { group: { rows: FindingRow[] } }).group.rows.map(
        (row) => row.summary,
      ),
    ).toEqual(["v", "w"]);

    const flipped = inspectorContent(
      module("d/a.py"),
      inputsFor([scan], {
        tab: "findings",
        findingRows: () => [warningRow, violationRow],
        expanded: new Set(["findings:kind:rule"]),
      }),
    ).rows;

    expect(flipped[0]).toMatchObject({ open: true });
  });

  it("shows a finding a second sensor wrote, with its summary and principle", () => {
    const loaded = fixtureScan("check", "scan.json", CURRENT);
    const modules = loaded.scan.modules.map((one) => one.id);
    const health = computeHealth({
      scans: [loaded],
      policy: null,
      modules,
      baseline: null,
      findings: [secondSensorDocument("shop/main.py")],
    });
    const rows = inspectorContent(
      module("shop/main.py"),
      inputsFor([loaded.scan], {
        tab: "findings",
        findings: health.findings,
        findingRows: (id) =>
          findingRows(health.documents).filter((row) =>
            row.record.evidence.modules.includes(id),
          ),
      }),
    ).rows;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "finding-group",
      open: false,
      group: {
        name: "Magic numbers",
        rows: [
          {
            summary: "too many magic numbers",
            principle: "name-your-constants",
            severity: "warning",
          },
        ],
      },
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

  it("groups a folder's findings by kind across its modules, not per module", () => {
    const rowFor = (id: string): FindingRow => ({
      ...violationRow,
      id: `v-${id}`,
      module: id,
    });
    const findings = (id: string) =>
      id === "d/sub/b.py" || id === "d/a.py" ? [violation] : [];
    const content = inspectorContent(
      folder("d"),
      inputsFor([scan], {
        tab: "findings",
        findings,
        findingRows: (id) => (findings(id).length > 0 ? [rowFor(id)] : []),
      }),
    );

    expect(content.rows).toHaveLength(1);
    expect(content.rows[0]).toMatchObject({
      kind: "finding-group",
      key: "findings:kind:rule",
      open: false,
    });
    expect(
      (content.rows[0] as { group: { rows: FindingRow[] } }).group.rows.map(
        (row) => row.module,
      ),
    ).toEqual(["d/a.py", "d/sub/b.py"]);
    expect(content.tabs?.[2]?.label).toBe("Findings 2");
  });

  it("lists a finding once in a folder though several of its modules report it", () => {
    const content = inspectorContent(
      folder("d"),
      inputsFor([scan], {
        tab: "findings",
        findingRows: (id) => (id.startsWith("d/") ? [violationRow] : []),
      }),
    );
    const group = content.rows[0] as { group: { rows: FindingRow[] } };

    expect(group.group.rows).toHaveLength(1);
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
        findingRows: (id) => (id === "d/a.py" ? [violationRow] : []),
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

describe("dependency folder labels", () => {
  const labels = (keys: string[], own: string) =>
    Object.fromEntries(dependencyLabels(keys, own));

  it("drops the shared top package and names the own folder", () => {
    expect(
      labels(
        [
          "lightcycle/adapters/sqlite",
          "lightcycle/domain/feedback",
          "lightcycle/domain/work",
          "lightcycle/ports",
          "lightcycle/adapters",
        ],
        "lightcycle/adapters/sqlite",
      ),
    ).toEqual({
      "lightcycle/adapters/sqlite": "this folder",
      "lightcycle/domain/feedback": "domain/feedback/",
      "lightcycle/domain/work": "domain/work/",
      "lightcycle/ports": "ports/",
      "lightcycle/adapters": "adapters/",
    });
  });

  it("drops nothing when the first segments differ", () => {
    expect(labels(["lib/x", "app/y"], "app/y")).toEqual({
      "lib/x": "lib/x/",
      "app/y": "this folder",
    });
  });

  it("reads a key equal to the dropped segment as ./", () => {
    expect(
      labels(["lightcycle", "lightcycle/ports"], "lightcycle/ports"),
    ).toEqual({
      lightcycle: "./",
      "lightcycle/ports": "this folder",
    });
  });

  it("reads the root key as ./ and prevents any drop", () => {
    expect(labels(["", "lightcycle/ports"], "lightcycle/adapters")).toEqual({
      "": "./",
      "lightcycle/ports": "lightcycle/ports/",
      "lightcycle/adapters": "this folder",
    });
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
    flatRows(list).filter((row) => row.kind === "module");
  const section = (list: Row[], text: string) => {
    const panel = list.find(
      (row) => row.kind === "panel" && `${row.label} ${row.count}` === text,
    );

    return panel?.kind === "panel" ? panel.rows : [];
  };
  const labelsOf = (list: Row[]) =>
    list.flatMap((row) =>
      row.kind === "module" || row.kind === "folder-label" ? [row.label] : [],
    );

  it("has the tab Dependencies N with N the sum of the two counts", () => {
    const content = inspectorContent(
      module("hub.py"),
      inputsFor([scan], { counts: () => ({ uses: 3, usedBy: 1 }) }),
    );

    expect(content.tabs?.map((tab) => tab.label)).toEqual([
      "Contents",
      "Dependencies 4",
      "Findings",
    ]);
  });

  it("lists the filter, the Uses header and rows, then the Used by header and rows", () => {
    const list = rows({});

    expect(list[0]).toMatchObject({ kind: "filter" });
    expect(
      list.flatMap((row) =>
        row.kind === "panel" ? [`${row.label} ${row.count}`] : [],
      ),
    ).toEqual(["Uses 3", "Used by 1"]);
    expect(list[1]).toMatchObject({
      kind: "panel",
      direction: "uses",
      caption: "hub.py imports these",
    });
    expect(list[2]).toMatchObject({
      kind: "panel",
      direction: "usedBy",
      caption: "these import hub.py",
    });
    expect(list.map((row) => row.kind)).not.toContain("legend");
  });

  it("lists the modules a module uses under folder headings with their full path, then the module rows", () => {
    const list = section(rows({}), "Uses 3");

    expect(labelsOf(list)).toEqual(["a/", "x.py", "y.py", "b/", "z.py"]);
    expect(list[0]).toMatchObject({ kind: "folder-label", count: 2 });
    expect(list[1]).toMatchObject({
      indent: true,
      detail: null,
      discFirst: true,
    });
  });

  it("lists the modules that use a module in the Used by section", () => {
    const list = section(rows({}), "Used by 1");

    expect(labelsOf(list)).toEqual(["this folder", "caller.py"]);
    expect(list[0]).toMatchObject({ key: "" });
  });

  it("starts with a filter field summing both sections and ticks rows that are on the canvas", () => {
    const list = rows({ onCanvas: open("a/x.py") });

    expect(list[0]).toMatchObject({
      kind: "filter",
      placeholder: "Filter 4 modules",
    });
    expect(moduleRows(list)[0]).toMatchObject({ state: "checked", bold: true });
    expect(moduleRows(list)[1]).toMatchObject({ state: "unchecked" });
    expect(section(list, "Uses 3")[0]).toMatchObject({
      kind: "folder-label",
      allOn: false,
    });
  });

  it("keeps both sections open whatever expanded holds", () => {
    const list = rows({
      expanded: new Set(["dependencies:uses", "dependencies:usedBy"]),
    });

    expect(list.filter((row) => row.kind === "panel").length).toBe(2);
    expect(section(list, "Uses 3").length).toBe(5);
    expect(section(list, "Used by 1").length).toBe(2);
  });

  it("filters both sections by module and by name", () => {
    const list = rows({ filter: "z" });

    expect(labelsOf(section(list, "Uses 3"))).toEqual(["b/", "z.py"]);
    expect(section(list, "Used by 1")).toEqual([
      { kind: "note", text: "Nothing matches." },
    ]);
    expect(labelsOf(section(rows({ filter: "Hub" }), "Used by 1"))).toEqual([
      "this folder",
      "caller.py",
    ]);
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

  it("gives folder rows no chevron and lists their modules whatever expanded holds", () => {
    const labels = (expanded: Set<string>) =>
      moduleRows(section(rows({ expanded }), "Uses 3")).map((row) => [
        row.label,
        row.chevron,
      ]);

    expect(labels(new Set())).toEqual(
      labels(new Set(["a", "b", "dependencies:uses", "dependencies:usedBy"])),
    );
    expect(labels(new Set()).every(([, chevron]) => chevron === null)).toBe(
      true,
    );
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

    expect(content.tabs?.[1]?.label).toBe("Dependencies 10");
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
    flatRows(rows).filter(
      (row): row is Extract<Row, { kind: "module" }> => row.kind === "module",
    );

  it("makes module rows followable in the section they are listed under", () => {
    const rows = moduleRows(dependencies());

    expect(rows.map((row) => [row.id, row.follow])).toEqual([
      ["partner.py", "uses"],
      ["a/x.py", "uses"],
      ["partner.py", "usedBy"],
    ]);
  });

  it("leaves folder headings and Contents rows unfollowable", () => {
    const headings = flatRows(dependencies()).filter(
      (row) => row.kind === "folder-label",
    );
    const contents = inspectorContent(
      folder("a"),
      inputsFor([scan], { tab: "contents" }),
    ).rows;

    expect(headings.length).toBeGreaterThan(0);
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

  it("lists followable rows in displayed order ", () => {
    expect(followableRows(dependencies())).toEqual([
      { id: "partner.py", relation: "uses" },
      { id: "a/x.py", relation: "uses" },
      { id: "partner.py", relation: "usedBy" },
    ]);
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

describe("compacted folders", () => {
  const compacted: Scan = {
    modules: [
      { id: "core/data/src/main/A.kt", kind: "module" },
      { id: "core/data/src/main/B.kt", kind: "module" },
      { id: "core/Top.kt", kind: "module" },
    ],
    edges: [],
    foreign: [],
  };

  it("lists a child chain as one compacted folder row", () => {
    const rows = inspectorContent(
      folder("core"),
      inputsFor([compacted]),
    ).rows.filter((row) => row.kind === "module" && row.folder);

    expect(rows).toMatchObject([
      { id: "core/data/src/main", label: "data/src/main/" },
    ]);
  });

  it("headers a compacted folder with its joined label", () => {
    const { header } = inspectorContent(
      folder("core/data/src/main"),
      inputsFor([compacted]),
    );

    expect(header.title).toBe("data/src/main/");
  });
});

describe("signatures shared with recognizer show", () => {
  type Expected = {
    name: string;
    signature: string;
    fields: string[];
    methods: string[];
  };

  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const read = (path: string) => readFileSync(join(REPO, path), "utf8");
  const expected = JSON.parse(read("fixtures/signatures.json")) as Record<
    string,
    Record<string, Expected[]>
  >;

  for (const [file, modules] of Object.entries(expected)) {
    it(`gives every card in ${file} the text show prints`, () => {
      const scan = JSON.parse(read(file)) as Scan;

      for (const [id, members] of Object.entries(modules)) {
        const cards = cardsOf(
          inspectorContent(module(id), {
            ...inputsFor([scan]),
            showPrivate: true,
          }).rows,
        );
        const actual = cards
          .map((card) => ({
            head: plainText(card.head),
            lines: card.lines.map((line) => plainText(line.tokens)).sort(),
          }))
          .sort((a, b) => a.head.localeCompare(b.head));
        const wanted = members
          .map((member) => ({
            head: member.signature,
            lines: [...member.fields, ...member.methods].sort(),
          }))
          .sort((a, b) => a.head.localeCompare(b.head));

        expect(actual.map((card) => card.head)).toEqual(
          wanted.map((card) => card.head),
        );

        for (const [index, card] of actual.entries()) {
          const lines = wanted[index]?.lines ?? [];

          expect(
            card.lines.filter((line) => line !== "outline not known"),
          ).toEqual(lines);
        }
      }
    });
  }
});

describe("the metric table on a card", () => {
  const metric = (
    label: string,
    values: MetricDescriptor["values"],
    extra: Partial<MetricDescriptor> = {},
  ): MetricDescriptor => ({
    key: `t/${label}`,
    label,
    title: label,
    granularity: "member",
    type: "count",
    bad: "high",
    overlay: "t",
    max: 12,
    values,
    ...extra,
  });
  const tableRows = (members: ScanMember[], metrics: MetricDescriptor[]) =>
    cardsOf(rowsOf(scanOf(members), { metrics, showPrivate: true }));
  const cls = klass();

  it("lists each method by short name with a dash for an unmeasured one", () => {
    const [card] = tableRows(
      [cls],
      [
        metric("complexity", { "pkg/m.py::C.go": 12 }),
        metric(
          "coverage",
          { "pkg/m.py::C.go": 0.5 },
          { type: "ratio", bad: "low", max: 1 },
        ),
      ],
    );

    expect(card?.table?.head).toEqual([
      { text: "cc", title: "Cyclomatic complexity" },
      { text: "cov", title: "Coverage" },
    ]);
    expect(card?.table?.rows.map((row) => row.name)).toEqual(
      (cls.methods ?? []).map((method) => method.name),
    );
    expect(card?.table?.rows[0]?.cells).toEqual([
      { text: "12", tone: "red", title: "Cyclomatic complexity 12" },
      { text: "50%", tone: "amber", title: "Coverage 50%" },
    ]);
    expect(card?.table?.rows[1]?.cells[0]).toEqual({
      text: "-",
      tone: null,
      title: "Cyclomatic complexity: not measured",
    });
  });

  it("gives a function card no table, since its metrics are a row", () => {
    const [card] = tableRows(
      [fn("f", true)],
      [metric("crap", { "pkg/m.py::f": 3 })],
    );

    expect(card?.table).toBeNull();
    expect(card?.metricsRow).toBeNull();
  });

  it("names the mutation columns short and any other metric by its name", () => {
    const [card] = tableRows(
      [cls],
      [
        metric(
          "score",
          { "pkg/m.py::C.go": 1 },
          { overlay: "mutate", type: "ratio", bad: "low", max: 1 },
        ),
        metric("survived", { "pkg/m.py::C.go": 1 }, { overlay: "mutate" }),
        metric("flaky", { "pkg/m.py::C.go": 1 }),
      ],
    );

    expect(card?.table?.head.map((column) => column.text)).toEqual([
      "mut",
      "surv",
      "flaky",
    ]);
    expect(card?.table?.head.map((column) => column.title)).toEqual([
      "Mutation score",
      "Survived mutants",
      "flaky",
    ]);
    expect(card?.table?.rows[0]?.cells.map((cell) => cell.title)).toEqual([
      "Mutation score 100%",
      "Survived mutants 1",
      "flaky 1",
    ]);
  });

  it("has no table without a member metric or on a card of another kind", () => {
    const moduleLevel = metric(
      "line_coverage",
      { "pkg/m.py": 1 },
      { granularity: "module" },
    );
    const constant: ScanMember = {
      name: "K",
      kind: "constant",
      exported: true,
    };

    expect(tableRows([fn("f", true)], [moduleLevel])[0]?.table).toBeNull();
    expect(tableRows([fn("f", true)], [])[0]?.table).toBeNull();
    expect(
      tableRows([constant], [metric("complexity", { "pkg/m.py::K": 1 })])[0]
        ?.table ?? null,
    ).toBeNull();
  });
});

describe("function length on a card", () => {
  const spanning = (name: string, line: number, lines: number): ScanMember =>
    fn(name, true, { line, end_line: line + lines - 1 });
  const cards = (members: ScanMember[], extra: Partial<InspectorInputs> = {}) =>
    cardsOf(rowsOf(scanOf(members), extra));

  it("bands a function card at the edges and drops the start line from its label", () => {
    const found = cards([
      spanning("at_long", 1, LONG_FUNCTION),
      spanning("over_long", 30, LONG_FUNCTION + 1),
      spanning("at_huge", 60, HUGE_FUNCTION),
      spanning("over_huge", 120, HUGE_FUNCTION + 1),
    ]);

    expect(found.map((card) => card.size?.band)).toEqual([
      "neutral",
      "long",
      "long",
      "huge",
    ]);
    expect(found.map((card) => card.size?.text)).toEqual([
      "20 lines",
      "21 lines",
      "50 lines",
      "51 lines",
    ]);
    expect(found.every((card) => !card.showsLine)).toBe(true);
    expect(found[0]?.line).toBe(1);
    expect(found[0]?.module).toBe("pkg/m.py");
  });

  it("scales the bar against the module's largest function or method, shown or not", () => {
    const klassWithMethod = klass({
      methods: [
        {
          name: "_big",
          line: 100,
          end_line: 199,
          private: true,
          params: [],
        },
      ],
    });
    const found = cards([spanning("half", 1, 50), klassWithMethod]);

    expect(found[0]?.size?.width).toBe(50);
  });

  it("shows no size for a constant, a class or a function without an end line", () => {
    const found = cards([
      { name: "K", kind: "constant", exported: true, line: 1, value: "1" },
      klass(),
      fn("bare", true, { line: 9 }),
    ]);

    expect(found.map((card) => card.size)).toEqual([null, null, null]);
    expect(found[0]?.showsLine).toBe(true);
    expect(found[1]?.showsLine).toBe(true);
  });

  it("gives a method row its own size and a one-line function the singular", () => {
    const withSpan = klass({
      methods: [
        { name: "go", line: 6, end_line: 30, private: false, params: [] },
        { name: "plain", line: 40, private: false, params: [] },
      ],
    });
    const [card, one] = cards([withSpan, spanning("one", 90, 1)]);

    expect(card?.lines.map((line) => line.size?.text ?? null)).toEqual([
      null,
      "25 lines",
      null,
    ]);
    expect(card?.size).toBeNull();
    expect(one?.size?.text).toBe("1 line");
  });
});

describe("the metrics row on a function card", () => {
  const metric = (
    label: string,
    value: number | undefined,
    extra: Partial<MetricDescriptor> = {},
  ): MetricDescriptor => ({
    key: `t/${label}`,
    label,
    title: label,
    granularity: "member",
    type: "count",
    bad: "high",
    overlay: "t",
    max: 100,
    values: value === undefined ? {} : { "pkg/m.py::f": value },
    ...extra,
  });
  const row = (
    values: { cc?: number; crap?: number; cov?: number },
    extra: Partial<InspectorInputs> = {},
  ) =>
    cardsOf(
      rowsOf(scanOf([fn("f", true)]), {
        metricsOn: true,
        metrics: [
          metric("complexity", values.cc),
          metric("crap", values.crap, { type: "number" }),
          metric("coverage", values.cov, {
            type: "ratio",
            bad: "low",
            max: 1,
          }),
        ],
        ...extra,
      }),
    )[0]?.metricsRow;

  it("is absent when no metric is ticked", () => {
    const [card] = cardsOf(
      rowsOf(scanOf([fn("f", true)]), {
        metricsOn: false,
        metrics: [metric("complexity", 3)],
      }),
    );

    expect(card?.metricsRow).toBeNull();
  });

  it("colours each value by its limit, on both sides of every edge", () => {
    expect(row({ cc: 10, crap: 29, cov: 0.6 })?.map((c) => c.tone)).toEqual([
      null,
      null,
      null,
    ]);
    expect(row({ cc: 11, crap: 30, cov: 0.59 })?.map((c) => c.tone)).toEqual([
      "amber",
      "red",
      "amber",
    ]);
  });

  it("shows a dash with no tone for a value the overlay lacks", () => {
    expect(row({})?.map((c) => [c.text, c.tone])).toEqual([
      ["-", null],
      ["-", null],
      ["-", null],
    ]);
  });

  it("reads the configured limits and an off limit never colours", () => {
    const limits = { complexityAbove: null, coverageBelow: 0.8, crapAt: 20 };

    expect(
      row({ cc: 99, crap: 20, cov: 0.7 }, { limits })?.map((c) => c.tone),
    ).toEqual([null, "red", "amber"]);
  });

  it("names and formats the three cells", () => {
    expect(
      row({ cc: 4, crap: 7, cov: 0.5 })?.map((c) => [c.name, c.text]),
    ).toEqual([
      ["cc", "4"],
      ["CRAP", "7"],
      ["cov", "50%"],
    ]);
  });
});

describe("the proposed change on a plan", () => {
  const header = (id: string, extra: Partial<InspectorInputs>) =>
    inspectorContent(module(id), inputsFor([scanOf(undefined)], extra)).header;

  it("names the proposed change for every kind", () => {
    const words = {
      new: "New",
      changes: "Changes",
      moves: "Moves, code unchanged",
      "moves-and-changes": "Moves and changes",
      removed: "Removed",
    } as const;

    for (const [kind, word] of Object.entries(words)) {
      const proposed = {
        module: "pkg/m.py",
        kind: kind as keyof typeof words,
        ...(kind.startsWith("moves") ? { from: "old/m.py" } : {}),
      };

      expect(header("pkg/m.py", { proposed: () => proposed }).proposed).toBe(
        `Proposed change: ${word}`,
      );
    }
  });

  it("gives a move the path it comes from and others none", () => {
    expect(
      header("pkg/m.py", {
        proposed: () => ({
          module: "pkg/m.py",
          kind: "moves",
          from: "old/m.py",
        }),
      }).from,
    ).toBe("old/m.py");
    expect(
      header("pkg/m.py", {
        proposed: () => ({ module: "pkg/m.py", kind: "new" }),
      }).from,
    ).toBeUndefined();
  });

  it("shows no line for a module without one and still renders a module the scan lacks", () => {
    expect(header("pkg/m.py", {}).proposed).toBeUndefined();

    const planned = inspectorContent(
      module("pkg/new.py"),
      inputsFor([scanOf(undefined)], {
        proposed: () => ({ module: "pkg/new.py", kind: "new" }),
      }),
    );

    expect(planned.header.title).toBe("new.py");
    expect(planned.header.proposed).toBe("Proposed change: New");
  });
});
