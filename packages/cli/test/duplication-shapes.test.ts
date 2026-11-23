import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assignIdentities,
  DEFAULT_DUPLICATION_SETTINGS,
  findFunctions,
  grammarFor,
  isTrivialShape,
  measureDuplication,
  normalise,
  unitsInSource,
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
  measuredFixture,
  measuredSources,
  ROOT,
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
  const found = findFunctions(tree?.rootNode as never, "csharp");

  return found;
}

describe("the C# shapes and normalisation held over from the Python sensor", () => {
  for (const [source, shape] of SHAPES) {
    it(`classifies ${source} as ${shape ?? "neither shape"}`, async () => {
      const [first] = await csharp(source);

      expect(first).toBeDefined();
      expect(isTrivialShape((first as { node: never }).node)).toBe(
        shape !== null,
      );
    });
  }

  it("keeps a call's method name and loses the receiver name", async () => {
    const of = async (source: string) => {
      const [first] = await csharp(source);

      return JSON.stringify(
        normalise((first as { node: never }).node, new Set()),
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
      grammarFor("shapes.ts") as "typescript",
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
