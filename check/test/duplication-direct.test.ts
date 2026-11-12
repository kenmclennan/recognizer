import { describe, expect, it } from "vitest";
import {
  DEFAULT_DUPLICATION_SETTINGS,
  type DuplicationSettings,
} from "../src/duplication/findings.js";
import { fingerprints } from "../src/duplication/fingerprint.js";
import { findFunctions } from "../src/duplication/functions.js";
import type { Grammar } from "../src/duplication/grammars.js";
import { measureDuplication } from "../src/duplication/measure.js";
import { countNodes, normalise } from "../src/duplication/normalise.js";
import type { RecordedScan } from "../src/scan.js";
import {
  allParsers,
  measuredSources,
  ROOT,
  scansOf,
} from "./duplication-helpers.js";

const BODY = (name: string) =>
  `def ${name}(items, rate):\n    total = 0\n    for item in items:\n        if item.price > 0:\n            total += item.price * item.quantity\n    return total + rate\n`;

function sized(name: string, lines: number): string {
  const body = Array.from(
    { length: lines - 2 },
    (_, index) => `    v${index} = x + ${index}\n`,
  ).join("");

  return `def ${name}(x):\n${body}    return x\n`;
}

function distinct(name: string, lines: number): string {
  const body = Array.from(
    { length: lines - 2 },
    (_, index) => `    v${index} = x * ${index}\n`,
  ).join("");

  return `def ${name}(x):\n${body}    return x\n`;
}

function methodClass(name: string, methods: string[], lines: number): string {
  const body = methods
    .flatMap((method) => sized(method, lines).trimEnd().split("\n"))
    .map((line) => `    ${line}\n`)
    .join("");

  return `class ${name}:\n${body}`;
}

async function find(
  files: Record<string, string>,
  overrides: Partial<DuplicationSettings> = {},
  scans?: RecordedScan[],
) {
  const { fake, scans: listed } = measuredSources(files);
  const findings = measureDuplication(
    fake.io,
    ROOT,
    scans ?? listed,
    { ...DEFAULT_DUPLICATION_SETTINGS, ...overrides },
    await allParsers(),
  );

  return { findings, err: fake.err() };
}

const ids = (findings: { id: string }[]) => findings.map((one) => one.id);

describe("a file with a syntax error", () => {
  it("is skipped and the clean files still give their findings", async () => {
    const { findings } = await find({
      "clean.py": `${BODY("one")}\n\n${BODY("two")}`,
      "broken.py": "def f(:\n    pass\n    return (\n",
      "copy.py": BODY("three").replace("return total + rate", "return ("),
    });

    expect(ids(findings)).toEqual(["duplication:clean.py::one|clean.py::two"]);
  });
});

describe("a folder the scan does not list", () => {
  it("adds no module and no finding even when copies sit in it on disk", async () => {
    const files = {
      "src/One.py": sized("one", 8),
      "src/Two.py": sized("two", 8),
      "bin/One.py": sized("one", 8),
      "bin/Two.py": sized("two", 8),
      "src/Three.py": distinct("three", 8),
    };
    const listed = Object.fromEntries(
      Object.entries(files).filter(([path]) => !path.startsWith("bin/")),
    );
    const { findings } = await find(files, { min_nodes: 1 }, scansOf(listed));

    expect(ids(findings)).toEqual([
      "duplication:src/One.py::one|src/Two.py::two",
    ]);
    expect(JSON.stringify(findings)).not.toContain("bin/");
  });
});

describe("the size gates", () => {
  it("drops a pair below a raised min_lines and keeps it at the default", async () => {
    const files = { "a.py": sized("f", 7), "b.py": sized("g", 7) };

    expect((await find(files, { min_nodes: 1 })).findings).toHaveLength(1);
    expect(
      (await find(files, { min_nodes: 1, min_lines: 8 })).findings,
    ).toEqual([]);
  });

  it("drops a family below a raised min_lines", async () => {
    const files = Object.fromEntries(
      ["a", "b", "c"].map((name) => [`${name}.py`, sized(name, 7)]),
    );

    expect((await find(files, { min_nodes: 1 })).findings).toHaveLength(1);
    expect(
      (await find(files, { min_nodes: 1, min_lines: 8 })).findings,
    ).toEqual([]);
  });

  it("keeps a five-line pair only when pair_min_lines is lowered", async () => {
    const files = { "a.py": sized("f", 5), "b.py": sized("g", 5) };

    expect((await find(files, { min_nodes: 1 })).findings).toEqual([]);
    expect(
      (await find(files, { min_nodes: 1, pair_min_lines: 4 })).findings,
    ).toHaveLength(1);
  });

  it("gives a finding at exactly the node count of the function and none one above", async () => {
    const parsers = await allParsers();
    const tree = parsers.get("python")?.parse(BODY("f"));
    const [first] = findFunctions(tree?.rootNode as never, "python");
    const nodes = countNodes((first as { node: never }).node);
    const files = { "a.py": BODY("f"), "b.py": BODY("g") };

    expect((await find(files, { min_nodes: nodes })).findings).toHaveLength(1);
    expect((await find(files, { min_nodes: nodes + 1 })).findings).toEqual([]);
  });
});

describe("family ids", () => {
  it("name a three-function family by its first two members and its size", async () => {
    const { findings } = await find({
      "a.py": BODY("one"),
      "b.py": BODY("two"),
      "c.py": BODY("three"),
    });

    expect(ids(findings)).toEqual(["duplication:a.py::one|b.py::two#3"]);
    expect(findings[0]?.summary).toBe(
      "3 functions share one structure: one in a.py, two in b.py, three in c.py",
    );
  });

  it("keep the pair form for two functions", async () => {
    const { findings } = await find({
      "a.py": BODY("one"),
      "b.py": BODY("two"),
    });

    expect(ids(findings)).toEqual(["duplication:a.py::one|b.py::two"]);
    expect(findings[0]?.summary).toBe(
      "one in a.py is 100% similar to two in b.py",
    );
  });

  it("change their size suffix when a fourth member joins and stay the same otherwise", async () => {
    const files: Record<string, string> = Object.fromEntries(
      ["a", "b", "c"].map((name) => [`${name}.py`, BODY(`f_${name}`)]),
    );
    const three = await find(files);
    const again = await find(files);
    const four = await find({ ...files, "d.py": BODY("f_d") });

    expect(ids(three.findings)).toEqual(ids(again.findings));
    expect(ids(three.findings)).toEqual(["duplication:a.py::f_a|b.py::f_b#3"]);
    expect(ids(four.findings)).toEqual(["duplication:a.py::f_a|b.py::f_b#4"]);
  });

  it("suffix members that share a qualified name with their line", async () => {
    const copy =
      "class A:\n    def run(self, items):\n        total = 0\n        for item in items:\n            total += item.price\n        return total\n";
    const { findings } = await find(
      { "a.py": copy + copy },
      { min_nodes: 1, pair_min_lines: 4 },
    );

    expect(ids(findings)).toEqual(["duplication:a.py::A.run@2|a.py::A.run@8"]);
  });

  it("give two separate families in one file two findings", async () => {
    const other = (name: string) =>
      `def ${name}(rows):\n    out = []\n    for row in rows:\n        out.append(row.name.upper())\n    return out\n`;
    const source = [
      BODY("a1"),
      BODY("a2"),
      BODY("a3"),
      other("b1"),
      other("b2"),
      other("b3"),
    ].join("\n\n");
    const { findings } = await find({ "m.py": source }, { min_nodes: 1 });

    expect(ids(findings).sort()).toEqual([
      "duplication:m.py::a1|m.py::a2#3",
      "duplication:m.py::b1|m.py::b2#3",
    ]);
  });
});

describe("class summaries", () => {
  it("name the class when three methods of one class share a structure", async () => {
    const { findings } = await find(
      { "a.py": methodClass("C", ["f", "g", "h"], 5) },
      { min_nodes: 1 },
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.summary).toBe("3 methods of C share one structure");
    expect(findings[0]?.evidence.members).toHaveLength(3);
    expect(findings[0]?.id.endsWith("#3")).toBe(true);
  });

  it("keep the names summary across two classes and for free functions", async () => {
    const split = await find(
      {
        "a.py": methodClass("C", ["f", "g"], 5) + methodClass("D", ["h"], 5),
      },
      { min_nodes: 1 },
    );
    const free = await find(
      { "a.py": ["f", "g", "h"].map((n) => `${sized(n, 5)}\n`).join("") },
      { min_nodes: 1 },
    );

    for (const { findings } of [split, free]) {
      expect(findings).toHaveLength(1);
      expect(
        findings[0]?.summary.startsWith("3 functions share one structure: "),
      ).toBe(true);
    }
  });

  it("keep the pair summary for two methods of a class", async () => {
    const { findings } = await find(
      { "a.py": methodClass("C", ["f", "g"], 6) },
      { min_nodes: 1 },
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.summary).toContain("% similar to");
  });
});

const PYTHON = `def compute(items, rate):
    total = 0
    for item in items:
        if item.price > 0:
            total += helper(item.price) * 2
    return total + rate
`;

const PYTHON_RENAMED = `def other_name(lines, percent):
    amount = 0
    for line in lines:
        if line.cost > 0:
            amount += helper(line.cost) * 7
    return amount + percent
`;

const TYPESCRIPT = `function compute(items: Item[], rate: number): number {
  let total = 0;
  for (const item of items) {
    if (item.price > 0) {
      total += helper(item.price) * 2;
    }
  }
  return total + rate;
}
`;

const TYPESCRIPT_RENAMED = `function other(lines: Line[], percent: number): number {
  let amount = 0;
  for (const line of lines) {
    if (line.cost > 0) {
      amount += helper(line.cost) * 9;
    }
  }
  return amount + percent;
}
`;

const KOTLIN = `fun compute(items: List<Item>, rate: Int): Int {
    var total = 0
    for (item in items) {
        if (item.price > 0) {
            total += helper(item.price) * 2
        }
    }
    return total + rate
}
`;

const KOTLIN_RENAMED = `fun other(lines: List<Line>, percent: Int): Int {
    var amount = 0
    for (line in lines) {
        if (line.cost > 0) {
            amount += helper(line.cost) * 5
        }
    }
    return amount + percent
}
`;

const RUST = `fn compute(items: &[Item], rate: i32) -> i32 {
    let mut total = 0;
    for item in items {
        if item.price > 0 {
            total += helper(item.price) * 2;
        }
    }
    total + rate
}
`;

const RUST_RENAMED = `fn other(lines: &[Line], percent: i32) -> i32 {
    let mut amount = 0;
    for line in lines {
        if line.cost > 0 {
            amount += helper(line.cost) * 3;
        }
    }
    amount + percent
}
`;

const CASES: [Grammar, string, string][] = [
  ["python", PYTHON, PYTHON_RENAMED],
  ["typescript", TYPESCRIPT, TYPESCRIPT_RENAMED],
  ["tsx", TYPESCRIPT, TYPESCRIPT_RENAMED],
  ["kotlin", KOTLIN, KOTLIN_RENAMED],
  ["rust", RUST, RUST_RENAMED],
];

async function prints(grammar: Grammar, source: string): Promise<string> {
  const parsers = await allParsers();
  const tree = parsers.get(grammar)?.parse(source);
  const found = findFunctions(tree?.rootNode as never, grammar);
  const first = found[0] as { node: never };

  expect(first).toBeDefined();
  expect((first.node as { hasError: boolean }).hasError).toBe(false);

  const normalised = normalise(first.node, new Set());

  expect(normalised).not.toBeNull();

  return [...fingerprints(normalised as never)].sort().join("|");
}

function reorder(grammar: Grammar, source: string): string {
  if (grammar === "python") {
    return source
      .replace("    total = 0\n", "")
      .replace(
        "    return total + rate",
        "    total = 0\n    return total + rate",
      );
  }

  const declaration = {
    typescript: "  let total = 0;\n",
    tsx: "  let total = 0;\n",
    kotlin: "    var total = 0\n",
    rust: "    let mut total = 0;\n",
  }[grammar as "typescript" | "tsx" | "kotlin" | "rust"];
  const tail = {
    typescript: "  return total + rate;",
    tsx: "  return total + rate;",
    kotlin: "    return total + rate",
    rust: "    total + rate",
  }[grammar as "typescript" | "tsx" | "kotlin" | "rust"];

  return source.replace(declaration, "").replace(tail, `${declaration}${tail}`);
}

describe("normalisation", () => {
  for (const [grammar, original, renamed] of CASES) {
    it(`keeps the fingerprints when ${grammar} names and literals are renamed`, async () => {
      expect(await prints(grammar, original)).toBe(
        await prints(grammar, renamed),
      );
    });

    it(`changes the fingerprints when a called name changes in ${grammar}`, async () => {
      expect(await prints(grammar, original)).not.toBe(
        await prints(grammar, original.replaceAll("helper", "different")),
      );
    });

    it(`changes the fingerprints when an operator changes in ${grammar}`, async () => {
      expect(await prints(grammar, original)).not.toBe(
        await prints(grammar, original.replace("total +=", "total -=")),
      );
    });

    it(`changes the fingerprints when statement order changes in ${grammar}`, async () => {
      expect(await prints(grammar, original)).not.toBe(
        await prints(grammar, reorder(grammar, original)),
      );
    });
  }

  it("drops comments", async () => {
    const commented = PYTHON.replace(
      "    total = 0\n",
      "    total = 0  # start\n",
    );

    expect(await prints("python", PYTHON)).toBe(
      await prints("python", commented),
    );
  });

  it("keeps the final name of a member call", async () => {
    const one = "def f(a):\n    return a.first(1)\n";
    const two = "def f(a):\n    return a.second(1)\n";

    expect(await prints("python", one)).not.toBe(await prints("python", two));
  });
});
