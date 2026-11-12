import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FindingRecord, FindingsDocument } from "recognizer";
import { describe, expect, it } from "vitest";
import { sentenceOf } from "./finding-sentence";
import { findingRows } from "./findings-order";

const examples = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../schema/findings-examples/valid",
);

function load(name: string): FindingsDocument {
  return JSON.parse(
    readFileSync(join(examples, `${name}.json`), "utf8"),
  ) as FindingsDocument;
}

const FILES = [
  "structure",
  "crap",
  "duplication",
  "mutation",
  "thresholds",
  "registered-sensor",
  "report",
];

const PINNED = [
  "order.py imports memory_store.py, which the policy forbids: domain may not use adapters.",
  "money.py and order.py import each other.",
  "audit.py is imported by nothing and is not an entry point; a library can list its public API in warnings.orphan.entry_points.",
  "fake_clock.py is imported only by 2 test files and is not an entry point; if it only supports tests, move it next to them; a library can list its public API in warnings.orphan.entry_points.",
  "classify in risk.py has complexity 8 and 18% coverage, C.R.A.P. 43.",
  "sumWithLevy in pricing.ts repeats the structure of totalWithTax in pricing.ts (10 lines).",
  "grade in rules.py has 2 surviving mutations.",
  "billing.py has churn 25, over the limit of 20.",
  "price in billing.py has complexity 14, over the limit of 10.",
  "helper is exported and never imported",
  "The order total is stored without checking it against its lines.",
];

function record(over: Partial<FindingRecord>): FindingRecord {
  return {
    id: "x",
    kind: "cycle",
    severity: "warning",
    principle: "p",
    summary: "the summary",
    evidence: { modules: [] },
    ...over,
  };
}

const sentence = (over: Partial<FindingRecord>, reported = false) =>
  sentenceOf({ record: record(over), reported });

describe("unused_exports test-only names", () => {
  const unused = (members: { name: string; test_files?: string[] }[]) =>
    sentence({
      kind: "unused_exports",
      evidence: {
        modules: ["x/plan.py"],
        members: members.map((member) => ({ module: "x/plan.py", ...member })),
      },
    });

  const hint =
    "; a library can list its public API in warnings.orphan.entry_points";

  it("names the one marked name in the singular", () => {
    expect(
      unused([{ name: "a", test_files: ["t/test_a.py"] }, { name: "b" }]),
    ).toBe(
      `plan.py exports 2 names no other module imports: a, b. Only tests import a: if nothing outside the repository uses it, delete it with its tests${hint}.`,
    );
  });

  it("names several marked names in the plural", () => {
    expect(
      unused([
        { name: "a", test_files: ["t/test_a.py"] },
        { name: "b", test_files: ["t/test_a.py"] },
      ]),
    ).toBe(
      `plan.py exports 2 names no other module imports: a, b. Only tests import a, b: if nothing outside the repository uses them, delete them with their tests${hint}.`,
    );
  });

  it("leaves an unmarked sentence unchanged", () => {
    expect(unused([{ name: "a" }])).toBe(
      "plan.py exports 1 name no other module imports: a.",
    );
  });
});

describe("the committed findings examples", () => {
  it("render exactly the 11 pinned sentences", () => {
    const rows = FILES.flatMap((name) => findingRows([load(name)]));

    expect(
      rows.map((row) =>
        sentenceOf({ record: row.record, reported: row.reported }),
      ),
    ).toEqual(PINNED);
  });

  it("never leak a path with a folder, an id or the word undefined", () => {
    for (const line of PINNED) {
      expect(line).not.toContain("undefined");
      expect(line).not.toMatch(/[a-z]+\/[a-z_]+\.py/);
      expect(line).not.toMatch(/^[a-z_-]+:/);
    }
  });
});

describe("sentenceOf orphan", () => {
  const orphanOf = (importers: { file: string; names: string[] }[]) =>
    sentence({
      kind: "orphan",
      evidence: {
        modules: ["app/fake.py"],
        ...(importers.length > 0 ? { test_importers: importers } : {}),
      },
    });

  it("says nothing imports a module no test imports", () => {
    expect(orphanOf([])).toBe(
      "fake.py is imported by nothing and is not an entry point; a library can list its public API in warnings.orphan.entry_points.",
    );
  });

  it("says one test file imports it, singular", () => {
    expect(orphanOf([{ file: "tests/test_a.py", names: [] }])).toBe(
      "fake.py is imported only by 1 test file and is not an entry point; if it only supports tests, move it next to it; a library can list its public API in warnings.orphan.entry_points.",
    );
  });

  it("counts several test files", () => {
    expect(
      orphanOf([
        { file: "tests/test_a.py", names: [] },
        { file: "tests/test_b.py", names: ["X"] },
        { file: "tests/test_c.py", names: [] },
      ]),
    ).toBe(
      "fake.py is imported only by 3 test files and is not an entry point; if it only supports tests, move it next to them; a library can list its public API in warnings.orphan.entry_points.",
    );
  });
});

describe("sentenceOf orphan library hint", () => {
  const hint =
    "; a library can list its public API in warnings.orphan.entry_points.";
  const orphanIn = (module: string, tests: number) =>
    sentence({
      kind: "orphan",
      evidence: {
        modules: [module],
        ...(tests > 0
          ? {
              test_importers: Array.from({ length: tests }, (_, i) => ({
                file: `t/t${i}.kt`,
                names: [],
              })),
            }
          : {}),
      },
    });

  it("adds the hint to a Kotlin orphan", () => {
    expect(orphanIn("lib/Api.kt", 0)).toBe(
      `Api.kt is imported by nothing and is not an entry point${hint}`,
    );
  });

  it("adds the hint to a Kotlin orphan only tests import", () => {
    expect(orphanIn("lib/Api.kt", 1)).toBe(
      `Api.kt is imported only by 1 test file and is not an entry point; if it only supports tests, move it next to it${hint}`,
    );
  });

  it("adds the hint to a Python orphan", () => {
    expect(orphanIn("lib/api.py", 0)).toBe(
      `api.py is imported by nothing and is not an entry point${hint}`,
    );
  });

  it("adds the hint to a C# orphan", () => {
    expect(orphanIn("lib/Api.cs", 0)).toBe(
      `Api.cs is imported by nothing and is not an entry point${hint}`,
    );
  });
});

describe("sentenceOf", () => {
  it("names a three-module cycle", () => {
    expect(
      sentence({ evidence: { modules: ["x/a.py", "x/b.py", "x/c.py"] } }),
    ).toBe("a.py, b.py and c.py form a cycle of 3.");
  });

  it("says unknown coverage when the crap finding has none", () => {
    expect(
      sentence({
        kind: "crap",
        evidence: {
          modules: ["x/footer.py"],
          members: [{ module: "x/footer.py", name: "StatusBar.report" }],
          measures: { complexity: 30 },
        },
      }),
    ).toBe(
      "StatusBar.report in footer.py has complexity 30 and unknown coverage.",
    );
  });

  it("uses the singular for one exported name and one mutation", () => {
    expect(
      sentence({
        kind: "unused_exports",
        evidence: {
          modules: ["x/plan.py"],
          members: [{ module: "x/plan.py", name: "a" }],
        },
      }),
    ).toBe("plan.py exports 1 name no other module imports: a.");
    expect(
      sentence({
        kind: "mutation",
        evidence: {
          modules: ["x/rules.py"],
          members: [{ module: "x/rules.py", name: "apply" }],
          measures: { survived: 1 },
        },
      }),
    ).toBe("apply in rules.py has 1 surviving mutation.");
  });

  it("lists several unused exports", () => {
    expect(
      sentence({
        kind: "unused_exports",
        evidence: {
          modules: ["x/plan.py"],
          members: [
            { module: "x/plan.py", name: "a" },
            { module: "x/plan.py", name: "b" },
            { module: "x/plan.py", name: "c" },
          ],
        },
      }),
    ).toBe("plan.py exports 3 names no other module imports: a, b, c.");
  });

  it("reads a threshold at, over and under its limit", () => {
    const at = (value: number, line: number) =>
      sentence({
        kind: "thresholds.coverage",
        evidence: { modules: ["x/a.py"], measures: { value, line } },
      });

    expect(at(10, 10)).toBe("a.py has coverage 10, at the limit of 10.");
    expect(at(12, 10)).toBe("a.py has coverage 12, over the limit of 10.");
    expect(at(0.5, 0.6)).toBe("a.py has coverage 0.5, under the limit of 0.6.");
  });

  it("falls back to the summary when required evidence is absent", () => {
    expect(sentence({ kind: "orphan", evidence: { modules: [] } })).toBe(
      "the summary",
    );
  });

  it("uses the summary unchanged for a report and an unknown kind", () => {
    expect(sentence({ kind: "cycle" }, true)).toBe("the summary");
    expect(sentence({ kind: "mystery" })).toBe("the summary");
  });

  it("drops the rule clause when an edge has no rule, and writes a foreign edge kind as is", () => {
    expect(
      sentence({
        kind: "rule-violation",
        evidence: {
          modules: ["x/a.py"],
          edges: [{ from: "x/a.py", to: "y/b.py", kind: "calls" }],
        },
      }),
    ).toBe("a.py calls b.py, which the policy forbids.");
  });

  it("reads uses and forbid rules", () => {
    const edge = (rule: object) =>
      sentence({
        kind: "rule-violation",
        evidence: {
          modules: ["x/a.py"],
          edges: [
            {
              from: "x/a.py",
              to: "y/b.py",
              kind: "depends",
              rules: [rule as never],
            },
          ],
        },
      });

    expect(
      edge({ type: "uses", from_component: "app", to_component: "db" }),
    ).toBe("a.py imports b.py, which the policy forbids: app may not use db.");
    expect(edge({ type: "forbid", pattern: "y/**" })).toBe(
      "a.py imports b.py, which the policy forbids: nothing may match y/**.",
    );
  });
});

describe("the duplication sentence", () => {
  const member = (name: string, module: string, lines?: [number, number]) => ({
    module,
    name,
    file: module,
    ...(lines === undefined ? {} : { lines }),
  });
  const family = (members: ReturnType<typeof member>[]) =>
    sentence({
      kind: "duplication",
      evidence: { modules: [], members },
    });

  it("keeps the pair sentence", () => {
    expect(
      family([
        member("a", "src/x.py", [1, 5]),
        member("b", "src/y.py", [1, 9]),
      ]),
    ).toBe("a in x.py repeats the structure of b in y.py (9 lines).");
  });

  it("names three members and the longest span", () => {
    expect(
      family([
        member("a", "src/x.py", [1, 5]),
        member("b", "src/y.py", [1, 9]),
        member("c", "src/z.py", [1, 7]),
      ]),
    ).toBe(
      "3 functions repeat one structure: a in x.py, b in y.py and c in z.py (9 lines).",
    );
  });

  it("reads a family of one class as methods of that class", () => {
    const methods = ["C.a", "C.b", "C.c"].map((name, index) =>
      member(name, "src/x.py", [1, 4 + index]),
    );

    expect(family(methods)).toBe(
      "3 methods of C repeat one structure (6 lines).",
    );
  });

  it("keeps the names sentence for methods of two classes", () => {
    expect(
      family([
        member("C.a", "src/x.py", [1, 5]),
        member("C.b", "src/x.py", [1, 5]),
        member("D.c", "src/x.py", [1, 5]),
      ]),
    ).toBe(
      "3 functions repeat one structure: C.a in x.py, C.b in x.py and D.c in x.py (5 lines).",
    );
  });

  it("drops the tail when no member has lines", () => {
    expect(
      family([
        member("a", "src/x.py"),
        member("b", "src/y.py"),
        member("c", "src/z.py"),
      ]),
    ).toBe(
      "3 functions repeat one structure: a in x.py, b in y.py and c in z.py.",
    );
  });

  it("counts one more member", () => {
    expect(
      family([
        member("a", "src/x.py", [1, 5]),
        member("b", "src/y.py", [1, 5]),
        member("c", "src/z.py", [1, 5]),
        member("d", "src/w.py", [1, 5]),
      ]),
    ).toBe(
      "4 functions repeat one structure: a in x.py, b in y.py, c in z.py and 1 more (5 lines).",
    );
  });

  it("names three of 22 members and takes the span from a later one", () => {
    const members = Array.from({ length: 22 }, (_, index) =>
      member(`m${index}`, `src/f${index}.py`, [1, index === 20 ? 30 : 5]),
    );

    expect(family(members)).toBe(
      "22 functions repeat one structure: m0 in f0.py, m1 in f1.py, m2 in f2.py and 19 more (30 lines).",
    );
  });
});
