import { describe, expect, it } from "vitest";
import { boxTooltip, notePreview } from "./box-tooltip";

describe("boxTooltip", () => {
  it("shows the current line plainly", () => {
    expect(boxTooltip({ kind: "current", line: "Reads scans." }, null)).toEqual(
      [{ text: "Reads scans.", tone: "normal" }],
    );
  });

  it("dims an out-of-date line", () => {
    expect(
      boxTooltip(
        { kind: "out-of-date", line: "Reads scans.", reasons: ["source"] },
        null,
      ),
    ).toEqual([{ text: "Reads scans.", tone: "dim" }]);
  });

  it("says there is no description yet, muted, when the line is missing or unknown", () => {
    const muted = [{ text: "No description yet", tone: "muted" }];

    expect(boxTooltip({ kind: "missing" }, null)).toEqual(muted);
    expect(boxTooltip({ kind: "unknown", reason: "bad json" }, null)).toEqual(
      muted,
    );
  });

  it("adds the note beneath in the muted tone", () => {
    expect(
      boxTooltip({ kind: "current", line: "Reads scans." }, "Split this up"),
    ).toEqual([
      { text: "Reads scans.", tone: "normal" },
      { text: "Note: Split this up", tone: "muted" },
    ]);
  });

  it("adds no note line for a blank note", () => {
    expect(boxTooltip({ kind: "missing" }, "  ")).toHaveLength(1);
  });
});

describe("notePreview", () => {
  it("keeps sixty characters and marks the cut", () => {
    const text = "a".repeat(80);

    expect(notePreview(text)).toBe(`${"a".repeat(60)}…`);
  });

  it("leaves a short note whole and flattens line breaks", () => {
    expect(notePreview("one\ntwo")).toBe("one two");
  });
});
