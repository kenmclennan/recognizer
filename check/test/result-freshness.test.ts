import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildFreshness,
  moduleOf,
  splitFindings,
} from "../src/result-freshness.js";
import type { Scan } from "../src/scan.js";

const H0 = "0".repeat(64);
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const T = "a".repeat(64);
const T2 = "b".repeat(64);

function scanOf(hashes: Record<string, string>): Scan {
  return {
    modules: Object.keys(hashes).map((id) => ({ id, kind: "module" })),
    edges: [],
    foreign: [],
    files: Object.entries(hashes).map(([path, hash]) => ({ path, hash })),
  } as unknown as Scan;
}

const SCAN = scanOf({ "a.py": H1, "b.py": H2 });
const KEYS = ["a.py::f", "b.py::g"];

describe("the worked example", () => {
  it("counts 1 of 2 when b.py was edited", () => {
    const freshness = buildFreshness([SCAN], T);
    const measured = { inputs: { "a.py": H1, "b.py": H0 }, tests: T };

    expect(freshness.current(measured, "a.py")).toBe(true);
    expect(freshness.current(measured, "b.py")).toBe(false);
    expect(freshness.counts(measured, KEYS)).toEqual({
      outOfDate: 1,
      total: 2,
    });
  });

  it("counts 0 of 2 when every hash matches", () => {
    const measured = { inputs: { "a.py": H1, "b.py": H2 }, tests: T };

    expect(buildFreshness([SCAN], T).counts(measured, KEYS)).toEqual({
      outOfDate: 0,
      total: 2,
    });
  });

  it("counts 2 of 2 when both files were edited", () => {
    const measured = { inputs: { "a.py": H0, "b.py": H0 }, tests: T };

    expect(buildFreshness([SCAN], T).counts(measured, KEYS)).toEqual({
      outOfDate: 2,
      total: 2,
    });
  });

  it("counts 2 of 2 after a test edit though both file hashes match", () => {
    const measured = { inputs: { "a.py": H1, "b.py": H2 }, tests: T };

    expect(buildFreshness([SCAN], T2).counts(measured, KEYS)).toEqual({
      outOfDate: 2,
      total: 2,
    });
  });
});

describe("buildFreshness", () => {
  it("treats a file with no inputs as out of date everywhere", () => {
    const freshness = buildFreshness([SCAN], T);

    expect(freshness.current({}, "a.py")).toBe(false);
    expect(freshness.valid({})).toBe(false);
    expect(freshness.counts({}, KEYS)).toEqual({ outOfDate: 2, total: 2 });
  });

  it("is out of date when tests are recorded and the current hash is unknown", () => {
    const measured = { inputs: { "a.py": H1 }, tests: T };

    expect(buildFreshness([SCAN], null).current(measured, "a.py")).toBe(false);
  });

  it("is current when no tests are recorded whatever the current hash", () => {
    expect(
      buildFreshness([SCAN], null).current({ inputs: { "a.py": H1 } }, "a.py"),
    ).toBe(true);
  });

  it("counts a module no scan lists in neither side", () => {
    const measured = { inputs: { "a.py": H1, "gone.py": H1 } };

    expect(buildFreshness([SCAN], null).counts(measured, [])).toEqual({
      outOfDate: 0,
      total: 1,
    });
    expect(buildFreshness([SCAN], null).counts({}, ["gone.py::f"])).toEqual({
      outOfDate: 0,
      total: 0,
    });
  });

  it("has no current hash for a module without a file hash", () => {
    const scan = scanOf({ "a.py": H1 });
    const measured = { inputs: { "x.py": H1 } };

    expect(buildFreshness([scan], null).current(measured, "x.py")).toBe(false);
  });

  it("enables a group one short of all out of date and not at all", () => {
    const freshness = buildFreshness([SCAN], null);
    const some = freshness.counts({ inputs: { "a.py": H1, "b.py": H0 } }, []);
    const all = freshness.counts({ inputs: { "a.py": H0, "b.py": H0 } }, []);

    expect(some.outOfDate).toBe(some.total - 1);
    expect(all.outOfDate).toBe(all.total);
  });

  it("finds a module's hash in any loaded scan", () => {
    const freshness = buildFreshness(
      [scanOf({ "a.py": H1 }), scanOf({ "c.ts": H2 })],
      null,
    );

    expect(freshness.current({ inputs: { "c.ts": H2 } }, "c.ts")).toBe(true);
  });

  it("resolves a member key to its module", () => {
    expect(moduleOf("a.py::f")).toBe("a.py");
    expect(moduleOf("a.py")).toBe("a.py");
    expect(buildFreshness([SCAN], null).moduleOf("b.py::g")).toBe("b.py");
  });
});

describe("the committed sample scan", () => {
  it("takes the scan's placeholder hash, never the file's disk hash", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(
      resolve(here, "../.."),
      "fixtures/mutation/sample/scan.python.json",
    );
    const scan = JSON.parse(readFileSync(path, "utf8")) as Scan;
    const freshness = buildFreshness([scan], null);

    expect(
      freshness.current({ inputs: { "app/rules.py": H0 } }, "app/rules.py"),
    ).toBe(true);
    expect(
      freshness.current({ inputs: { "app/rules.py": H1 } }, "app/rules.py"),
    ).toBe(false);
  });
});

describe("splitFindings", () => {
  function record(id: string, modules: string[]) {
    return {
      id,
      kind: "x",
      severity: "warning" as const,
      principle: "p",
      summary: id,
      evidence: { modules },
    };
  }

  const findings = [
    record("a", ["a.py"]),
    record("b", ["b.py"]),
    record("ab", ["a.py", "b.py"]),
    record("none", []),
  ];

  function documentOf(overrides: Record<string, unknown>) {
    return {
      findings_version: 2,
      sensor: { name: "s", version: "1" },
      commit: "c",
      modified: false,
      settings: {},
      findings,
      ...overrides,
    } as unknown as import("../src/findings-document.js").FindingsDocument;
  }

  const ids = (records: { id: string }[]) => records.map((one) => one.id);

  it("splits current from hidden by the modules each finding names", () => {
    const split = splitFindings(
      documentOf({ inputs: { "a.py": H1, "b.py": H0 }, tests: T }),
      buildFreshness([SCAN], T),
    );

    expect(ids(split.current)).toEqual(["a", "none"]);
    expect(ids(split.hidden)).toEqual(["b", "ab"]);
  });

  it("hides every finding when the tests hash differs", () => {
    const split = splitFindings(
      documentOf({ inputs: { "a.py": H1, "b.py": H0 }, tests: T }),
      buildFreshness([SCAN], T2),
    );

    expect(split.current).toEqual([]);
    expect(split.hidden).toHaveLength(4);
  });

  it("hides every finding when the document has no inputs", () => {
    const split = splitFindings(documentOf({}), buildFreshness([SCAN], T));

    expect(split.current).toEqual([]);
    expect(split.hidden).toHaveLength(4);
  });

  it("hides nothing when every input matches", () => {
    const split = splitFindings(
      documentOf({ inputs: { "a.py": H1, "b.py": H2 }, tests: T }),
      buildFreshness([SCAN], T),
    );

    expect(split.hidden).toEqual([]);
    expect(split.current).toHaveLength(4);
  });
});
