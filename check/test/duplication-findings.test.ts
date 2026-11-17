import { describe, expect, it } from "vitest";
import { DEFAULT_DUPLICATION_SETTINGS } from "../src/duplication/findings.js";
import { measureDuplication } from "../src/duplication/measure.js";
import {
  allParsers,
  EQUIVALENCE,
  measuredFixture,
  ROOT,
  readJson,
} from "./duplication-helpers.js";
import { REPO } from "./helpers.js";

const CASES: [string, string][] = [
  ["python", "fixtures/duplication/corpus/python"],
  ["typescript", "fixtures/duplication/corpus/typescript"],
  ["kotlin", "fixtures/duplication/corpus/kotlin"],
  ["rust", "fixtures/duplication/corpus/rust"],
  ["csharp", "fixtures/duplication/corpus/csharp"],
  ["sample", "fixtures/duplication/sample"],
  ["crap-corpus", "fixtures/crap/corpus"],
];

const COUNTS: Record<string, number> = {
  python: 7,
  typescript: 7,
  kotlin: 7,
  rust: 7,
  csharp: 7,
};

describe("duplication findings against the Python sensor's goldens", () => {
  for (const [name, directory] of CASES) {
    it(`gives the golden findings for ${name}`, async () => {
      const golden = readJson<unknown[]>(
        `${EQUIVALENCE}/findings.${name}.json`,
      );
      const { fake, scans } = measuredFixture(directory);

      if (!["sample", "crap-corpus"].includes(name)) {
        expect(golden.length).toBeGreaterThan(0);
      }

      const findings = measureDuplication(
        fake.io,
        ROOT,
        scans,
        DEFAULT_DUPLICATION_SETTINGS,
        await allParsers(),
      );

      expect(findings).toEqual(golden);

      if (name in COUNTS) {
        expect(findings).toHaveLength(COUNTS[name] as number);
      }

      expect(fake.err()).toBe("");
    });
  }
});

describe("the corpus manifest", () => {
  interface Entry {
    language: string;
    a: string;
    b: string;
    expected: string;
  }

  for (const language of Object.keys(COUNTS)) {
    it(`reports every reported ${language} entry and no not-reported one`, async () => {
      const manifest = readJson<Entry[]>(
        `${REPO}/fixtures/duplication/corpus/manifest.json`,
      ).filter((entry) => entry.language === language);
      const { fake, scans } = measuredFixture(
        `fixtures/duplication/corpus/${language}`,
      );
      const findings = measureDuplication(
        fake.io,
        ROOT,
        scans,
        DEFAULT_DUPLICATION_SETTINGS,
        await allParsers(),
      );
      const pairs = new Set(
        findings.flatMap((finding) => {
          const names = (finding.evidence.members ?? []).map(
            (member) => `${member.file}::${member.name}`,
          );

          return names.flatMap((x) => names.map((y) => `${x}|${y}`));
        }),
      );
      const has = (entry: Entry) =>
        pairs.has(`${entry.a}|${entry.b}`) && entry.a !== entry.b;

      expect(manifest.length).toBeGreaterThan(0);

      for (const entry of manifest) {
        expect(has(entry), `${entry.a} ~ ${entry.b}`).toBe(
          entry.expected === "reported",
        );
      }
    });
  }
});
