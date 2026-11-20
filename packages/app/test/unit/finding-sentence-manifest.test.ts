import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FindingRecord, FindingsDocument } from "recognizer";
import { describe, expect, it } from "vitest";
import { buildCatalog } from "../../src/finding-catalog";
import { sentenceOf } from "../../src/finding-sentence";
import { shippedSensors } from "../../src/shipped-fake";

const srcUrl = new URL("../../src/index.ts", import.meta.url).href;

const REPO = join(dirname(fileURLToPath(srcUrl)), "../../..");
const EXAMPLES = join(REPO, "schema/findings-examples/valid");
const CATALOG = buildCatalog({ status: "ok", sensors: shippedSensors() });

const KINDS = [
  { sensor: "crap", match: (kind: string) => kind === "crap" },
  { sensor: "mutation", match: (kind: string) => kind === "mutation" },
  { sensor: "coverage", match: (kind: string) => kind === "coverage" },
];

const OLD_EXAMPLE_SENTENCES: Record<string, string> = {
  "counts.json|mutation|mutation:app/rules.py::grade":
    "grade in rules.py has 2 surviving mutations.",
  "crap.json|crap|crap:app/risk.py::classify":
    "classify in risk.py has complexity 8 and 18% coverage, C.R.A.P. 43.",
  "diagnosis-custom-code.json|crap|crap:app/risk.py::classify":
    "classify in risk.py has complexity 8 and 18% coverage, C.R.A.P. 43.",
  "diagnosis-unmeasured.json|crap|crap:app/risk.py::classify":
    "classify in risk.py has complexity 8 and 18% coverage, C.R.A.P. 43.",
  "diagnosis.json|crap|crap:app/risk.py::classify":
    "classify in risk.py has complexity 8 and 18% coverage, C.R.A.P. 43.",
  "excluded.json|mutation|mutation:app/rules.py::grade":
    "grade in rules.py has 2 surviving mutations.",
  "mutation.json|mutation|mutation:app/rules.py::grade":
    "grade in rules.py has 2 surviving mutations.",
  "partial.json|mutation|mutation:app/rules.py::grade":
    "grade in rules.py has 2 surviving mutations.",
  "stopped.json|mutation|mutation:app/rules.py::grade":
    "grade in rules.py has 2 surviving mutations.",
  "suites.json|crap|crap:app/risk.py::classify":
    "classify in risk.py has complexity 8 and 18% coverage, C.R.A.P. 43.",
  "crap.json|coverage|coverage:app/risk.py::classify":
    "classify in risk.py has coverage 0.18, under the limit of 0.6.",
  "unowned.json|mutation|mutation:app/rules.py::grade":
    "grade in rules.py has 2 surviving mutations.",
  "work-and-ran.json|mutation|mutation:app/rules.py::grade":
    "grade in rules.py has 2 surviving mutations.",
};

const OLD_HAND_SENTENCES: Record<string, string[]> = {
  crap: [
    "f in m.py has complexity 8.46 and unknown coverage.",
    "f in m.py has complexity 8 and 50% coverage, C.R.A.P. 12, over the limit of 30.",
    "f in m.py has complexity 8 and 50% coverage, C.R.A.P. 12, over the limit of 20.",
    "the summary",
    "f in m.py has complexity 8.46 and unknown coverage, over the limit of 30.",
  ],
  mutation: [
    "f in m.py has 1 surviving mutation.",
    "f in m.py has 0 surviving mutations.",
    "the summary",
  ],
  coverage: [
    "m.py has coverage 0.4, under the limit of 0.7.",
    "f in m.py has coverage 0.4, under the limit of 0.6.",
    "the summary",
  ],
};

function exampleRecords(
  match: (kind: string) => boolean,
): { file: string; record: FindingRecord }[] {
  return readdirSync(EXAMPLES)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) =>
      (
        JSON.parse(
          readFileSync(join(EXAMPLES, name), "utf8"),
        ) as FindingsDocument
      ).findings
        .filter((record) => match(record.kind))
        .map((record) => ({ file: name, record })),
    );
}

function record(
  kind: string,
  evidence: Record<string, unknown>,
  summary = "the summary",
): FindingRecord {
  return {
    id: `${kind}:x`,
    kind,
    severity: "warning",
    principle: "p",
    summary,
    evidence: { modules: ["app/m.py"], ...evidence },
  } as unknown as FindingRecord;
}

const MEMBER = { module: "app/m.py", name: "f" };

const HAND_BUILT: Record<string, FindingRecord[]> = {
  crap: [
    record("crap", { members: [MEMBER], measures: { complexity: 8.456 } }),
    record("crap", {
      members: [MEMBER],
      measures: { complexity: 8, coverage: 0.5, crap: 12.4, limit: 30 },
    }),
    record("crap", {
      members: [MEMBER],
      measures: {
        complexity: 8,
        coverage: 0.5,
        crap: 12.4,
        limit: 20,
        published: 30,
      },
    }),
    record("crap", { members: [MEMBER], measures: {} }),
    record("crap", {
      members: [MEMBER],
      measures: { complexity: 8.456, limit: 30 },
    }),
  ],
  mutation: [
    record("mutation", { members: [MEMBER], measures: { survived: 1 } }),
    record("mutation", { members: [MEMBER], measures: { survived: 0 } }),
    record("mutation", { members: [MEMBER], measures: {} }),
  ],
  coverage: [
    record("coverage", { measures: { coverage: 0.4, limit: 0.7 } }),
    record("coverage", {
      members: [MEMBER],
      measures: { coverage: 0.4, limit: 0.6 },
    }),
    record("coverage", { measures: {} }),
  ],
};

const catalogSentence = (one: FindingRecord) =>
  sentenceOf({ record: one, reported: false }, CATALOG);

describe.each(KINDS)("the $sensor catalog sentence", ({ sensor, match }) => {
  const examples = exampleRecords(match);

  it("is rendered for at least one record of the kind in the examples", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it.each(
    examples.map(
      ({ file, record: one }) =>
        [`${one.kind} ${one.id} in ${file}`, file, one] as const,
    ),
  )("renders what the removed builder returned for %s", (_, file, one) => {
    expect(catalogSentence(one)).toBe(
      OLD_EXAMPLE_SENTENCES[`${file}|${one.kind}|${one.id}`],
    );
  });

  it.each(
    (HAND_BUILT[sensor] as FindingRecord[]).map(
      (one, index) => [`${one.kind} case ${index}`, one, index] as const,
    ),
  )(
    "renders what the removed builder returned for the hand-built %s",
    (_, one, index) => {
      expect(catalogSentence(one)).toBe(
        (OLD_HAND_SENTENCES[sensor] as string[])[index],
      );
    },
  );

  it("shows the finding's own summary when a required path is missing", () => {
    const bare = record(sensor, {});

    expect(catalogSentence(bare)).toBe("the summary");
  });
});

describe("the crap and coverage popover means", () => {
  const meansOf = (file: string, kind: string): string =>
    JSON.parse(
      readFileSync(join(REPO, "schema/manifest-examples/valid", file), "utf8"),
    ).findings.find((entry: { kind: string }) => entry.kind === kind).group
      .means;

  const count = (text: string, part: string) => text.split(part).length - 1;

  it("names the crap source once", () => {
    expect(count(meansOf("sensor-crap.json", "crap"), "Savoia and Evans")).toBe(
      1,
    );
  });

  it("names each coverage source once", () => {
    const means = meansOf("sensor-crap.json", "coverage");

    expect(count(means, "McCabe")).toBe(0);
    expect(count(means, "Google")).toBe(1);
  });
});
