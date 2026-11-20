import { describe, expect, it } from "vitest";
import {
  type FindingEntry,
  matchKind,
  renderSentence,
  type Sentence,
  sentenceProblems,
} from "../src/plugin-sentence.js";

const ENTRY: FindingEntry = {
  kind: "thresholds.<metric>",
  group: { name: "n", means: "m", todo: "t" },
  help: "h",
  sentence: {
    requires: ["evidence.measures.value"],
    parts: [
      [{ text: "{metric} {evidence.measures.value|num}" }],
      [
        {
          when: [{ has: "evidence.measures.published" }],
          text: " published {evidence.measures.published|percent}%",
        },
      ],
      [
        {
          when: [{ path: "kind", is: "thresholds.x" }],
          text: " {evidence.name|short} {evidence.count|plural:item:items}",
        },
      ],
    ],
  },
};

function record(kind: string, evidence: Record<string, unknown>) {
  return { kind, summary: "the summary", evidence };
}

describe("matchKind", () => {
  it("binds a placeholder segment and rejects a different shape", () => {
    expect(matchKind("thresholds.<metric>", "thresholds.churn")).toEqual({
      metric: "churn",
    });
    expect(matchKind("crap", "crap")).toEqual({});
    expect(matchKind("crap", "mutation")).toBeNull();
    expect(matchKind("thresholds.<metric>", "thresholds")).toBeNull();
  });
});

describe("renderSentence", () => {
  it("fills slots, the placeholder and each format", () => {
    const text = renderSentence(
      ENTRY,
      record("thresholds.x", {
        measures: { value: 3.456, published: 0.6 },
        name: "a/b/c.py",
        count: 1,
      }),
    );

    expect(text).toBe("x 3.46 published 60% c.py item");
  });

  it("uses the many form of plural and rounds whole", () => {
    const text = renderSentence(
      {
        ...ENTRY,
        sentence: {
          requires: [],
          parts: [[{ text: "{evidence.count|plural:a:b} {evidence.n|whole}" }]],
        },
      },
      record("thresholds.x", { count: 2, n: 2.5 }),
    );

    expect(text).toBe("b 3");
  });

  it("falls back to the summary when a required path is absent or the kind does not match", () => {
    expect(renderSentence(ENTRY, record("thresholds.x", {}))).toBe(
      "the summary",
    );
    expect(
      renderSentence(ENTRY, record("other", { measures: { value: 1 } })),
    ).toBe("the summary");
  });

  it("chooses the first variant whose conditions hold, and a left op right comparison", () => {
    const entry: FindingEntry = {
      ...ENTRY,
      sentence: {
        requires: [],
        parts: [
          [
            { when: [{ left: "a", op: "gt", right: "b" }], text: "over" },
            { when: [{ left: "a", op: "lt", right: "b" }], text: "under" },
            { when: [{ left: "a", op: "eq", right: "b" }], text: "at" },
            { text: "unknown" },
          ],
        ],
      },
    };

    expect(
      renderSentence(entry, { ...record("thresholds.x", {}), a: 2, b: 1 }),
    ).toBe("over");
    expect(
      renderSentence(entry, { ...record("thresholds.x", {}), a: 1, b: 2 }),
    ).toBe("under");
    expect(
      renderSentence(entry, { ...record("thresholds.x", {}), a: 1, b: 1 }),
    ).toBe("at");
    expect(renderSentence(entry, record("thresholds.x", {}))).toBe("unknown");
  });
});

describe("sentenceProblems", () => {
  const sentence = (text: string, path = "a.b"): Sentence => ({
    requires: [path],
    parts: [[{ text }]],
  });

  it("accepts the five formats and dotted paths", () => {
    expect(
      sentenceProblems(
        sentence(
          "{a|short} {a|num} {a|whole} {a|percent} {a|plural:x:y} {a.0.b}",
        ),
      ),
    ).toEqual([]);
  });

  it("names a format outside the five and a path that is not dotted", () => {
    expect(sentenceProblems(sentence("{a|bold}"))).toEqual([
      "slot {a|bold} has the unknown format bold",
    ]);
    expect(sentenceProblems(sentence("x", "a..b"))).toEqual([
      "a..b is not a dotted path",
    ]);
  });
});
