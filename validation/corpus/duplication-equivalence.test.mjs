import { describe, expect, it } from "vitest";
import {
  LIGHTCYCLE,
  compareFindings,
  skippedFiles,
  tableRow,
} from "./duplication-equivalence.mjs";

function finding(id, file = "a.py", similarity = 0.9) {
  return {
    id,
    kind: "duplication",
    evidence: {
      modules: [file],
      members: [{ module: file, name: "f", file, lines: [1, 8] }],
      measures: { similarity },
    },
  };
}

describe("compareFindings", () => {
  it("reports no difference for equal findings", () => {
    expect(compareFindings([finding("x")], [finding("x")])).toEqual([]);
  });

  it("names a missing, an extra and a changed finding", () => {
    expect(
      compareFindings(
        [finding("a"), finding("c", "a.py", 0.8)],
        [finding("b"), finding("c", "a.py", 0.9)],
      ),
    ).toEqual([
      { id: "a", cause: "missing-in-typescript" },
      { id: "c", cause: "different-record" },
      { id: "b", cause: "extra-in-typescript" },
    ]);
  });

  it("ascribes a difference in a skipped file to invalid UTF-8", () => {
    expect(compareFindings([finding("a", "bad.py")], [], ["bad.py"])).toEqual([
      { id: "a", cause: "invalid-utf8" },
    ]);
  });
});

describe("the helpers", () => {
  it("reads the skipped files from the scan's stderr", () => {
    expect(
      skippedFiles(
        "x\nduplication: skipped a/b.py: not valid UTF-8\nduplication: skipped c.py: not valid UTF-8\n",
      ),
    ).toEqual(["a/b.py", "c.py"]);
  });

  it("prints a row with the causes of its differences", () => {
    const row = {
      name: "flask",
      python: 3,
      typescript: 4,
      differences: [{ id: "a", cause: "extra-in-typescript" }],
    };

    expect(tableRow(row)).toBe(
      "flask | python 3 | typescript 4 | differences 1 (extra-in-typescript 1)",
    );
  });
});

describe("the extra lightcycle target", () => {
  it("names its row and clone folder after the commit and expects the base sensor's 45", () => {
    expect(LIGHTCYCLE.name).toBe(`lightcycle-${LIGHTCYCLE.commit.slice(0, 7)}`);
    expect(LIGHTCYCLE.expectedPython).toBe(45);
  });
});
