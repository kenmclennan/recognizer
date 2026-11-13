import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FindingRecord, FindingsDocument } from "recognizer";
import { describe, expect, it } from "vitest";
import { buildCatalog } from "./finding-catalog";
import { sentenceOf } from "./finding-sentence";
import { shippedSensors } from "./shipped-fake";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const EXAMPLES = join(REPO, "schema/findings-examples/valid");
const CATALOG = buildCatalog({ status: "ok", sensors: shippedSensors() });

const KINDS = [
  { sensor: "crap", match: (kind: string) => kind === "crap" },
  { sensor: "mutation", match: (kind: string) => kind === "mutation" },
  {
    sensor: "thresholds",
    match: (kind: string) => kind.startsWith("thresholds."),
  },
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
  "thresholds.json|thresholds.churn|thresholds:churn:app/billing.py":
    "billing.py has churn 25, over the limit of 20.",
  "thresholds.json|thresholds.complexity|thresholds:complexity:app/billing.py::price":
    "price in billing.py has complexity 14, over the limit of 10.",
  "unowned.json|mutation|mutation:app/rules.py::grade":
    "grade in rules.py has 2 surviving mutations.",
  "work-and-ran.json|mutation|mutation:app/rules.py::grade":
    "grade in rules.py has 2 surviving mutations.",
};

const OLD_HAND_SENTENCES: Record<string, string[]> = {
  crap: [
    "f in m.py has complexity 8.46 and unknown coverage.",
    "f in m.py has complexity 8 and 50% coverage, C.R.A.P. 12 (Savoia and Evans say 30).",
    "f in m.py has complexity 8 and 50% coverage, C.R.A.P. 12 (Savoia and Evans say 12.5).",
    "the summary",
  ],
  mutation: [
    "f in m.py has 1 surviving mutation.",
    "f in m.py has 0 surviving mutations.",
    "the summary",
  ],
  thresholds: [
    "m.py has complexity 10, at the limit of 10.",
    "m.py has complexity 4.5, under the limit of 10.",
    "f in m.py has complexity 14, over the limit of 12 (McCabe says 10).",
    "m.py has coverage 0.4, under the limit of 0.7 (Google's guidelines say 60%).",
    "m.py has churn 25, over the limit of 20 (McCabe says 15).",
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
      measures: { complexity: 8, coverage: 0.5, crap: 12.4, published: 30 },
    }),
    record("crap", {
      members: [MEMBER],
      measures: {
        complexity: 8,
        coverage: 0.5,
        crap: 12.4,
        limit: 20,
        published: 12.5,
      },
    }),
    record("crap", { members: [MEMBER], measures: {} }),
  ],
  mutation: [
    record("mutation", { members: [MEMBER], measures: { survived: 1 } }),
    record("mutation", { members: [MEMBER], measures: { survived: 0 } }),
    record("mutation", { members: [MEMBER], measures: {} }),
  ],
  thresholds: [
    record("thresholds.complexity", { measures: { value: 10, line: 10 } }),
    record("thresholds.complexity", { measures: { value: 4.5, line: 10 } }),
    record("thresholds.complexity", {
      members: [MEMBER],
      measures: { value: 14, line: 12, published: 10 },
    }),
    record("thresholds.coverage", {
      measures: { value: 0.4, line: 0.7, published: 0.6 },
    }),
    record("thresholds.churn", {
      measures: { value: 25, line: 20, published: 15 },
    }),
    record("thresholds.churn", { measures: { value: 25 } }),
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
    const bare = record(sensor === "thresholds" ? "thresholds.x" : sensor, {});

    expect(catalogSentence(bare)).toBe("the summary");
  });
});
