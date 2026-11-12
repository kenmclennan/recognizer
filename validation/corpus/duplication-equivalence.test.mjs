import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import {
  LIGHTCYCLE,
  compareFindings,
  median,
  skippedFiles,
  tableRow,
  timed,
  unitCacheFile,
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
  it("takes the median of three runs", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("reads the skipped files from the scan's stderr", () => {
    expect(
      skippedFiles(
        "x\nduplication: skipped a/b.py: not valid UTF-8\nduplication: skipped c.py: not valid UTF-8\n",
      ),
    ).toEqual(["a/b.py", "c.py"]);
  });

  it("prints a row with the load and flags added time over the line", () => {
    const row = {
      name: "flask",
      python: 3,
      typescript: 3,
      differences: [],
      added: 3.5,
      warm: 0.25,
      load: 12.34,
    };

    expect(tableRow(row)).toBe(
      "flask | python 3 | typescript 3 | differences 0 | added 3.50 s OVER | warm 0.25 s | load 12.3",
    );
  });
});

describe("the timing", () => {
  function fakeRecognizer(directory) {
    const log = join(directory, "seen.txt");
    const script = join(directory, "recognizer");

    writeFileSync(
      script,
      `#!/bin/sh\nif [ -f "$2/.recognizer/cache/duplication-units.json" ]; then echo cached >> "${log}"; else echo empty >> "${log}"; fi\nmkdir -p "$2/.recognizer/cache"\necho '{}' > "$2/.recognizer/cache/duplication-units.json"\n`,
    );
    chmodSync(script, 0o755);

    return { script, log };
  }

  it("starts every cold timed run with no unit cache file", () => {
    const directory = makeTempDir("duplication-equivalence-");
    const clone = join(directory, "clone");
    const { script, log } = fakeRecognizer(directory);

    mkdirSync(join(clone, ".recognizer/cache"), { recursive: true });
    writeFileSync(unitCacheFile(clone), "{}");

    timed({ recognizer: script }, clone, 3, { cold: true });

    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
      "empty",
      "empty",
      "empty",
    ]);
    expect(existsSync(unitCacheFile(clone))).toBe(true);
  });

  it("leaves the unit cache in place for warm timed runs", () => {
    const directory = makeTempDir("duplication-equivalence-");
    const clone = join(directory, "clone");
    const { script, log } = fakeRecognizer(directory);

    mkdirSync(join(clone, ".recognizer/cache"), { recursive: true });
    writeFileSync(unitCacheFile(clone), "{}");

    timed({ recognizer: script }, clone, 2);

    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
      "cached",
      "cached",
    ]);
  });
});

describe("the extra lightcycle target", () => {
  it("names its row and clone folder after the commit and expects the base sensor's 45", () => {
    expect(LIGHTCYCLE.name).toBe(`lightcycle-${LIGHTCYCLE.commit.slice(0, 7)}`);
    expect(LIGHTCYCLE.expectedPython).toBe(45);
  });
});
