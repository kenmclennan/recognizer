import { describe, expect, it } from "vitest";
import {
  DEFAULT_DUPLICATION_SETTINGS,
  type Finding,
  measureDuplication,
} from "../../src/index.js";
import {
  allParsers,
  EQUIVALENCE,
  FIXTURES,
  GRAMMAR_RULES,
  measuredFixture,
  ROOT,
  readJson,
} from "./measured-sources.js";

function recordOf(finding: Finding) {
  return {
    id: finding.id,
    kind: finding.kind,
    severity: finding.severity,
    principle: finding.principle,
    citation: finding.citation && { ...finding.citation },
    summary: finding.summary,
    fix_pattern: finding.fixPattern,
    metric: finding.metric,
    evidence: {
      modules: [...finding.files],
      members: finding.members?.map((member) => ({
        module: member.file,
        name: member.name,
        file: member.sourceFile,
        lines: member.lines && [...member.lines],
        test_files: member.testFiles && [...member.testFiles],
      })),
      measures: finding.measures && { ...finding.measures },
      producer: finding.producer,
    },
  };
}

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
      const { fakes, scans, say, err } = measuredFixture(directory);

      if (!["sample", "crap-corpus"].includes(name)) {
        expect(golden.length).toBeGreaterThan(0);
      }

      const findings = measureDuplication(
        fakes,
        say,
        ROOT,
        scans,
        DEFAULT_DUPLICATION_SETTINGS,
        await allParsers(),
        GRAMMAR_RULES,
      );

      expect(findings.map((warning) => recordOf(warning.toFinding()))).toEqual(
        golden,
      );

      if (name in COUNTS) {
        expect(findings).toHaveLength(COUNTS[name] as number);
      }

      expect(err).toEqual([]);
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
        `${FIXTURES}/duplication/corpus/manifest.json`,
      ).filter((entry) => entry.language === language);
      const { fakes, scans, say } = measuredFixture(
        `fixtures/duplication/corpus/${language}`,
      );
      const findings = measureDuplication(
        fakes,
        say,
        ROOT,
        scans,
        DEFAULT_DUPLICATION_SETTINGS,
        await allParsers(),
        GRAMMAR_RULES,
      );
      const pairs = new Set(
        findings.flatMap((finding) => {
          const names = (finding.members ?? []).map(
            (member) => `${member.sourceFile}::${member.name}`,
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
