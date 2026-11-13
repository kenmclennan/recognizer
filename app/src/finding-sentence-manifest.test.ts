import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type FindingEntry,
  type FindingRecord,
  type FindingsDocument,
  renderSentence,
} from "recognizer";
import { describe, expect, it } from "vitest";
import { sentenceOf } from "./finding-sentence";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const EXAMPLES = join(REPO, "schema/findings-examples/valid");

const KINDS = [
  { sensor: "crap", match: (kind: string) => kind === "crap" },
  { sensor: "mutation", match: (kind: string) => kind === "mutation" },
  {
    sensor: "thresholds",
    match: (kind: string) => kind.startsWith("thresholds."),
  },
];

function entryOf(sensor: string): FindingEntry {
  const text = execFileSync(
    "uv",
    [
      "run",
      "--project",
      join(REPO, "sensors"),
      `recognizer-sense-${sensor}`,
      "manifest",
    ],
    { encoding: "utf8" },
  );
  const [entry] = (JSON.parse(text) as { findings: FindingEntry[] }).findings;

  return entry as FindingEntry;
}

function exampleRecords(match: (kind: string) => boolean): FindingRecord[] {
  return readdirSync(EXAMPLES)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) =>
      (
        JSON.parse(
          readFileSync(join(EXAMPLES, name), "utf8"),
        ) as FindingsDocument
      ).findings.filter((record) => match(record.kind)),
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

describe.each(KINDS)("the $sensor manifest sentence", ({ sensor, match }) => {
  const entry = entryOf(sensor);
  const examples = exampleRecords(match);

  it("is rendered for at least one record of the kind in the examples", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it.each(examples.map((one) => [`${one.kind} ${one.id}`, one] as const))(
    "renders what sentenceOf returns for %s",
    (_, one) => {
      expect(renderSentence(entry, one)).toBe(
        sentenceOf({ record: one, reported: false }),
      );
    },
  );

  it.each(
    (HAND_BUILT[sensor] as FindingRecord[]).map(
      (one, index) => [`${one.kind} case ${index}`, one] as const,
    ),
  )("renders what sentenceOf returns for the hand-built %s", (_, one) => {
    expect(renderSentence(entry, one)).toBe(
      sentenceOf({ record: one, reported: false }),
    );
  });

  it("shows the finding's own summary when a required path is missing", () => {
    const bare = record(sensor === "thresholds" ? "thresholds.x" : sensor, {});

    expect(renderSentence(entry, bare)).toBe("the summary");
    expect(renderSentence(entry, bare)).toBe(
      sentenceOf({ record: bare, reported: false }),
    );
  });
});
