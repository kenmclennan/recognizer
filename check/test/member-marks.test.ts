import { describe, expect, it } from "vitest";
import type { MarkedModule } from "../src/change-marks.js";
import {
  MEMBER_TEXT_LIMIT,
  type MemberFile,
  memberMarks,
} from "../src/member-marks.js";
import type { RecordedScan, ScanMember } from "../src/scan.js";

const HEAD = "head1";
const MOD = "m/a.py";
const OTHER = "m/b.py";

function scan(
  modules: Record<string, ScanMember[]>,
  extra: Partial<RecordedScan> = {},
): RecordedScan {
  return {
    scanner: { name: "t", version: "1" },
    commit: HEAD,
    modified: false,
    files: [],
    selection: {} as RecordedScan["selection"],
    modules: Object.entries(modules).map(([id, members]) => ({
      id,
      kind: "module" as const,
      members,
    })),
    edges: [],
    foreign: [],
    ...extra,
  };
}

const fn = (name: string, line: number, end_line?: number): ScanMember => ({
  name,
  exported: true,
  kind: "function",
  line,
  ...(end_line === undefined ? {} : { end_line }),
});

const marked = (...ids: string[]): MarkedModule[] =>
  ids.map((id) => ({ id, mark: "modified", box: "current" }));

const file = (
  path: string,
  base_text: string | null,
  head_text: string | null,
): MemberFile => ({ path, base_text, head_text });

const START = [
  "def f():",
  "    a",
  "    b",
  "",
  "def g():",
  "    c",
  "    d",
  "    e",
].join("\n");
const F_START = fn("f", 1, 3);
const G_START = fn("g", 5, 8);

function run(
  startMembers: ScanMember[],
  endMembers: ScanMember[],
  head: string,
  start = START,
) {
  const result = memberMarks({
    modules: marked(MOD),
    headCommit: HEAD,
    current: [scan({ [MOD]: endMembers })],
    base: [scan({ [MOD]: startMembers }, { commit: null })],
    files: [file(MOD, start, head)],
  });

  return result.get(MOD);
}

describe("memberMarks worked examples", () => {
  it("marks neither function when they are only reordered", () => {
    const head = [
      "def g():",
      "    c",
      "    d",
      "    e",
      "",
      "def f():",
      "    a",
      "    b",
    ].join("\n");

    expect(
      run([F_START, G_START], [fn("g", 1, 4), fn("f", 6, 8)], head),
    ).toEqual(new Map());
  });

  it("marks only g when a line inside it changes", () => {
    const head = START.replace("    d", "    D");

    expect(run([F_START, G_START], [F_START, G_START], head)).toEqual(
      new Map([["g", "modified"]]),
    );
  });

  it("marks nothing when a blank line is inserted between the functions", () => {
    const head = START.replace("\n\ndef g", "\n\n\ndef g");

    expect(run([F_START, G_START], [F_START, fn("g", 6, 9)], head)).toEqual(
      new Map(),
    );
  });

  it("marks f and not g when the last line of f changes", () => {
    const head = START.replace("    b", "    B");

    expect(run([F_START, G_START], [F_START, G_START], head)).toEqual(
      new Map([["f", "modified"]]),
    );
  });

  it("marks g removed when it is deleted", () => {
    const head = ["def f():", "    a", "    b"].join("\n");

    expect(run([F_START, G_START], [F_START], head)).toEqual(
      new Map([["g", "removed"]]),
    );
  });

  it("marks a function added when it is absent at the start", () => {
    const head = `${START}\n\ndef h():\n    z`;

    expect(
      run([F_START, G_START], [F_START, G_START, fn("h", 10, 11)], head),
    ).toEqual(new Map([["h", "added"]]));
  });

  it("finds a span without end_line by the next sibling's line", () => {
    const head = START.replace("    b", "    B");

    expect(
      run([fn("f", 1), fn("g", 5)], [fn("f", 1), fn("g", 5)], head),
    ).toEqual(new Map([["f", "modified"]]));
  });

  it("counts a duplicate name as modified when the joined text differs", () => {
    const start = ["def f():", "    1", "def f():", "    2"].join("\n");
    const head = ["def f():", "    1", "def f():", "    3"].join("\n");

    expect(
      run(
        [fn("f", 1, 2), fn("f", 3, 4)],
        [fn("f", 1, 2), fn("f", 3, 4)],
        head,
        start,
      ),
    ).toEqual(new Map([["f", "modified"]]));
  });
});

describe("memberMarks on a class", () => {
  const klass = (
    end: number,
    methods: { name: string; line: number; end_line: number }[],
  ): ScanMember => ({
    name: "C",
    exported: true,
    kind: "class",
    line: 1,
    end_line: end,
    methods,
  });
  const base = [
    "class C:",
    "    def a(self):",
    "        1",
    "    def b(self):",
    "        2",
  ].join("\n");

  it("marks an added method and its class modified", () => {
    const head = `${base}\n    def c(self):\n        3`;

    expect(
      run(
        [
          klass(5, [
            { name: "a", line: 2, end_line: 3 },
            { name: "b", line: 4, end_line: 5 },
          ]),
        ],
        [
          klass(7, [
            { name: "a", line: 2, end_line: 3 },
            { name: "b", line: 4, end_line: 5 },
            { name: "c", line: 6, end_line: 7 },
          ]),
        ],
        head,
        base,
      ),
    ).toEqual(
      new Map([
        ["C.c", "added"],
        ["C", "modified"],
      ]),
    );
  });

  it("marks neither method nor the class when two methods are reordered", () => {
    const head = [
      "class C:",
      "    def b(self):",
      "        2",
      "    def a(self):",
      "        1",
    ].join("\n");

    expect(
      run(
        [
          klass(5, [
            { name: "a", line: 2, end_line: 3 },
            { name: "b", line: 4, end_line: 5 },
          ]),
        ],
        [
          klass(5, [
            { name: "b", line: 2, end_line: 3 },
            { name: "a", line: 4, end_line: 5 },
          ]),
        ],
        head,
        base,
      ),
    ).toEqual(new Map());
  });

  it("marks the class when its own text outside the methods changes", () => {
    const head = base.replace("class C:", "class C(Base):");

    expect(
      run(
        [
          klass(5, [
            { name: "a", line: 2, end_line: 3 },
            { name: "b", line: 4, end_line: 5 },
          ]),
        ],
        [
          klass(5, [
            { name: "a", line: 2, end_line: 3 },
            { name: "b", line: 4, end_line: 5 },
          ]),
        ],
        head,
        base,
      ),
    ).toEqual(new Map([["C", "modified"]]));
  });
});

describe("memberMarks absence and scope", () => {
  const input = (
    overrides: Partial<Parameters<typeof memberMarks>[0]> = {},
  ) => ({
    modules: marked(MOD),
    headCommit: HEAD,
    current: [scan({ [MOD]: [F_START] })],
    base: [scan({ [MOD]: [F_START] }, { commit: null })],
    files: [file(MOD, START, START)],
    ...overrides,
  });

  it("gives no marks to an added or removed module or one with no box", () => {
    const modules: MarkedModule[] = [
      { id: "x.py", mark: "added", box: "current" },
      { id: "y.py", mark: "removed", box: "base" },
      { id: "z.py", mark: "modified", box: "none" },
    ];

    expect(memberMarks(input({ modules })).size).toBe(0);
  });

  it("is unknown when a scan is not at the head commit or is modified", () => {
    expect(
      memberMarks(
        input({ current: [scan({ [MOD]: [] }, { commit: "old" })] }),
      ).get(MOD),
    ).toBeNull();
    expect(
      memberMarks(
        input({ current: [scan({ [MOD]: [] }, { modified: true })] }),
      ).get(MOD),
    ).toBeNull();
  });

  it("is unknown when the start side could not be read", () => {
    expect(memberMarks(input({ base: null })).get(MOD)).toBeNull();
    expect(memberMarks(input({ files: null })).get(MOD)).toBeNull();
    expect(
      memberMarks(input({ files: [file(MOD, null, START)] })).get(MOD),
    ).toBeNull();
  });

  it("leaves exactly the module over the size limit unknown", () => {
    const big = "x".repeat(MEMBER_TEXT_LIMIT + 1);
    const result = memberMarks(
      input({
        modules: marked(MOD, OTHER),
        current: [scan({ [MOD]: [F_START], [OTHER]: [F_START] })],
        base: [
          scan({ [MOD]: [F_START], [OTHER]: [F_START] }, { commit: null }),
        ],
        files: [
          file(MOD, START, START.replace("    a", "    A")),
          file(OTHER, big, START),
        ],
      }),
    );

    expect(result.get(MOD)).toEqual(new Map([["f", "modified"]]));
    expect(result.get(OTHER)).toBeNull();
  });
});
