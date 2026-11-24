import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assignIdentities,
  DEFAULT_DUPLICATION_SETTINGS,
  findFunctions,
  type GrammarRule,
  grammarFor,
  isTrivialShape,
  measureDuplication,
  normalise,
  unitsInSource,
  vocabularyOf,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import {
  GRAMMAR_DIRECTORY,
  loadParsers,
} from "../src/adapters/filesystem/parsing-adapter.js";
import { DigestAdapter } from "../src/adapters/system/digest-adapter.js";
import { analysisPortsOf, sayOf } from "./analysis-ports.js";
import {
  allParsers,
  GRAMMAR_RULES,
  measuredFixture,
  measuredSources,
  ROOT,
  ruleNamed,
} from "./duplication-helpers.js";
import { REPO } from "./helpers.js";

const SHAPES: [string, "constructor" | "accessor" | null][] = [
  ["class A { A(int a, int b) { this.a = a; this.b = 2; } }", "constructor"],
  ["class A { A(int a) { this.a = a + 1; } }", null],
  ["class A { A(int a) { this.a = other; } }", null],
  ["class A { A(int a) { this.a = a; Run(); } }", null],
  ["class A { A(int a) { this.a += a; } }", null],
  [
    'class A { int F() { return this.s.Section("k").Entry("x", 0); } }',
    "accessor",
  ],
  ['class A { int F => this.s.Section("k").Entry("x", 0); }', "accessor"],
  ["class A { int F => this.items[0]; }", "accessor"],
  ["class A { int F(int k) { return this.s.Get(k); } }", null],
  ["class A { int F() { var x = this.s; return x; } }", null],
  ["class A { int F { get { return this.s.Get(1); } } }", "accessor"],
];

async function csharp(source: string) {
  const parsers = await loadParsers(["csharp"], GRAMMAR_DIRECTORY);
  const tree = parsers.get("csharp")?.parse(source);
  const found = findFunctions(tree?.rootNode as never, ruleNamed("csharp"));

  return found;
}

const LANGUAGE_SHAPES: [string, string, "constructor" | "accessor" | null][] = [
  [
    "python",
    "class A:\n    def __init__(self, a, b):\n        self.a = a\n        self.b = 2\n",
    "constructor",
  ],
  [
    "python",
    "class A:\n    def __init__(self, a):\n        self.a = a + 1\n",
    null,
  ],
  [
    "python",
    "class A:\n    def f(self):\n        return self.s.get(1)\n",
    "accessor",
  ],
  [
    "python",
    "class A:\n    def f(self, k):\n        return self.s.get(k)\n",
    null,
  ],
  [
    "typescript",
    "class A { constructor(a, b) { this.a = a; this.b = 2; } }",
    "constructor",
  ],
  ["typescript", "class A { constructor(a) { this.a = a + 1; } }", null],
  ["typescript", "class A { f() { return this.s.get(1); } }", "accessor"],
  ["typescript", "class A { f(k) { return this.s.get(k); } }", null],
  [
    "rust",
    "impl A { fn new(a: i32, b: i32) -> A { A { a, b: 2 } } }",
    "constructor",
  ],
  ["rust", "impl A { fn new(a: i32) -> A { A { a: a + 1 } } }", null],
  ["rust", "impl A { fn f(&self) -> i32 { self.s.get(1) } }", "accessor"],
  ["rust", "impl A { fn f(&self, k: i32) -> i32 { self.s.get(k) } }", null],
  [
    "kotlin",
    "class A { fun init(a: Int, b: Int) { this.a = a; this.b = 2 } }",
    "constructor",
  ],
  ["kotlin", "class A { fun init(a: Int) { this.a = a + 1 } }", null],
  ["kotlin", "class A { fun f(): Int { return this.s.get(1) } }", "accessor"],
  ["kotlin", "class A { fun f(k: Int): Int { return this.s.get(k) } }", null],
];

describe("the shapes of the Python, TypeScript, Rust and Kotlin grammars", () => {
  for (const [language, source, shape] of LANGUAGE_SHAPES) {
    it(`classifies ${language} ${JSON.stringify(source)} as ${shape ?? "neither shape"}`, async () => {
      const parsers = await loadParsers([language], GRAMMAR_DIRECTORY);
      const tree = parsers.get(language)?.parse(source);
      const found = findFunctions(tree?.rootNode as never, ruleNamed(language));
      const target = found.at(-1);

      expect(target).toBeDefined();
      expect(
        isTrivialShape(
          (target as { node: never }).node,
          vocabularyOf(ruleNamed(language)),
        ),
      ).toBe(shape !== null);
    });
  }
});

describe("the C# shapes and normalisation held over from the Python sensor", () => {
  for (const [source, shape] of SHAPES) {
    it(`classifies ${source} as ${shape ?? "neither shape"}`, async () => {
      const [first] = await csharp(source);

      expect(first).toBeDefined();
      expect(
        isTrivialShape(
          (first as { node: never }).node,
          vocabularyOf(ruleNamed("csharp")),
        ),
      ).toBe(shape !== null);
    });
  }

  it("keeps a call's method name and loses the receiver name", async () => {
    const of = async (source: string) => {
      const [first] = await csharp(source);

      return JSON.stringify(
        normalise(
          (first as { node: never }).node,
          new Set(),
          vocabularyOf(ruleNamed("csharp")),
        ),
      );
    };
    const first = await of("class A { int F() { return one.Go(x); } }");
    const second = await of("class A { int F() { return two.Go(y); } }");
    const third = await of("class A { int F() { return one.Stop(x); } }");

    expect(first).toBe(second);
    expect(first).not.toBe(third);
  });

  it("finds nothing in the real C# fixture", async () => {
    const { fake, scans } = measuredFixture("fixtures/csharp/sample");

    expect(
      measureDuplication(
        analysisPortsOf(fake.io),
        sayOf(fake.io),
        ROOT,
        scans,
        DEFAULT_DUPLICATION_SETTINGS,
        await allParsers(),
        GRAMMAR_RULES,
      ),
    ).toEqual([]);
  });

  it("skips a file that is not valid UTF-8 and says so", async () => {
    const { fake, scans } = measuredSources({ "a.py": "x" });
    const bytes = Buffer.from([0xff, 0xfe, 0xfd]);
    const io = { ...fake.io, readBytes: () => bytes };

    expect(
      measureDuplication(
        analysisPortsOf(io),
        sayOf(io),
        ROOT,
        scans,
        DEFAULT_DUPLICATION_SETTINGS,
        await allParsers(),
        GRAMMAR_RULES,
      ),
    ).toEqual([]);
    expect(fake.err()).toContain("duplication: skipped a.py: not valid UTF-8");
  });

  it("measures this repository's own TypeScript without throwing and with unique ids", async () => {
    const parsers = await allParsers();
    const source = readFileSync(
      join(REPO, "packages/core/src/domain/analysis/duplication/shapes.ts"),
      "utf8",
    );
    const units = unitsInSource(
      "packages/core/src/domain/analysis/duplication/shapes.ts",
      "packages/core/src/domain/analysis/duplication/shapes.ts",
      source,
      grammarFor("shapes.ts", GRAMMAR_RULES) as GrammarRule,
      parsers,
      { ...DEFAULT_DUPLICATION_SETTINGS, min_lines: 1, min_nodes: 1 },
      new DigestAdapter().sha1Prefix,
    );
    const identities = assignIdentities(
      units.map(
        (unit) => [unit.module, unit.qualified, unit.startLine] as const,
      ),
    );

    expect(units.length).toBeGreaterThan(0);
    expect(new Set(identities).size).toBe(identities.length);
  });
});
