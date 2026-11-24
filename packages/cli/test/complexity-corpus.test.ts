import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  DEFAULT_STRUCTURE_SETTINGS,
  grammarFor,
  measureComplexity,
  measureSource,
  type Parsers,
} from "@recognizer/core";
import { beforeAll, describe, expect, it } from "vitest";
import { analysisPortsOf, sayOf } from "./analysis-ports.js";
import {
  allParsers,
  GRAMMAR_RULES,
  measuredSources,
  ROOT,
  readJson,
} from "./duplication-helpers.js";
import { REPO } from "./helpers.js";
import { BEHAVIOUR } from "./language-behaviour-fixture.js";

interface CrapCase {
  finding_id: string;
  measures: { complexity: number };
}

interface Planted {
  module: string;
  function: string;
  complexity: number;
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}

function sourcesUnder(base: string): Record<string, string> {
  const texts: Record<string, string> = {};

  for (const file of filesUnder(base)) {
    if (grammarFor(file, GRAMMAR_RULES) !== null) {
      texts[relative(base, file).split("\\").join("/")] = readFileSync(
        file,
        "utf8",
      );
    }
  }

  return texts;
}

let parsers: Parsers;

beforeAll(async () => {
  parsers = await allParsers();
});

describe("the count against the C.R.A.P. corpus", () => {
  it("equals measures.complexity for all 60 cases across five languages", () => {
    const base = join(REPO, "fixtures/crap/corpus");
    const texts = sourcesUnder(base);
    const cases = readJson<{ cases: CrapCase[] }>(
      join(base, "expected.json"),
    ).cases;
    const counted = new Map<string, number>();

    for (const [module, text] of Object.entries(texts)) {
      const rule = grammarFor(module, GRAMMAR_RULES);

      if (rule === null) {
        continue;
      }

      for (const fn of measureSource(module, text, rule, parsers)) {
        counted.set(fn.identity, fn.complexity);
      }
    }

    const matched = cases.filter((one) =>
      counted.has(one.finding_id.replace(/^crap:/, "")),
    );

    expect(cases).toHaveLength(60);
    expect(matched).toHaveLength(60);

    for (const one of cases) {
      expect(
        counted.get(one.finding_id.replace(/^crap:/, "")),
        one.finding_id,
      ).toBe(one.measures.complexity);
    }
  });
});

describe("the findings against the thresholds corpus", () => {
  it("reports exactly the 20 planted functions above 10, one each", () => {
    const base = join(REPO, "fixtures/coverage/corpus");
    const texts = sourcesUnder(base);
    const planted = readJson<{ planted: Planted[] }>(
      join(base, "expected.json"),
    ).planted;
    const { fake, scans } = measuredSources(texts);
    const findings = measureComplexity(
      analysisPortsOf(fake.io).source,
      sayOf(fake.io),
      ROOT,
      scans,
      null,
      DEFAULT_STRUCTURE_SETTINGS,
      parsers,
      GRAMMAR_RULES,
      BEHAVIOUR,
    );
    const bare = (id: string) => id.replace(/::(?:[^:]*\.)?/, "::");
    const expected = planted
      .filter((one) => one.complexity > 10)
      .map((one) => `complexity:${one.module}::${one.function}`)
      .sort();

    expect(planted).toHaveLength(50);
    expect(expected).toHaveLength(20);
    expect(findings.map((one) => bare(one.id))).toEqual(expected);
  });
});
