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
  "place.py is imported by 3 modules and imports 3; the limit is 3.",
  "app/adapters and app/application import each other, through 2 imports.",
  "audit.py is imported by nothing and is not an entry point.",
  "The policy names app/legacy/**, which matches no module.",
  "app/tools is covered by no policy layer.",
  "app/domain depends on app/util, which changes more often (instability 0.5 against 0.67).",
  "app/contracts is abstract and little depends on it (distance 1 from the main sequence).",
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

describe("the committed findings examples", () => {
  it("render exactly the 16 pinned sentences", () => {
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
    expect(sentence({ kind: "hub", evidence: { modules: ["x/a.py"] } })).toBe(
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

  it("writes the pain zone sentence", () => {
    expect(
      sentence({
        kind: "stable_abstractions",
        id: "stable_abstractions:lightcycle",
        evidence: {
          modules: [],
          measures: { abstractness: 0, instability: 0.23, distance: 0.77 },
        },
      }),
    ).toBe(
      "lightcycle is concrete and much depends on it, so it is hard to change (distance 0.77 from the main sequence).",
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
