import { describe, expect, it } from "vitest";
import {
  foldSummary,
  type SuiteResult,
  type SuiteRunning,
  suiteRows,
  suiteStanding,
  suitesBehind,
  tickedResults,
} from "../../src/index.js";

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-11-12T12:00:00.000Z");

const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ok = (name: string, ms: number): SuiteResult => ({
  name,
  status: "ok",
  ranAt: ago(ms),
});

describe("closed fold summary", () => {
  const summarize = (
    results: (SuiteResult | undefined)[],
    all = results.length,
    running: SuiteRunning | null = null,
  ) =>
    foldSummary({
      all,
      results: results.map((one) =>
        one === undefined ? undefined : suiteStanding(one),
      ),
      running,
      now: NOW,
    });

  it("reads none when no suite is ticked", () => {
    expect(summarize([], 3)).toEqual({ kind: "never", text: "none" });
  });

  it("reads the worst state: failed, then never, then partial, then the oldest age", () => {
    const failed: SuiteResult = {
      name: "web",
      status: "failed",
      ranAt: ago(MINUTE),
    };
    const partial: SuiteResult = {
      name: "integration",
      status: "partial",
      ranAt: ago(MINUTE),
      measured: 1,
      total: 2,
    };

    expect(summarize([ok("unit", HOUR), failed, undefined, partial])).toEqual({
      kind: "failed",
      text: "1 failed",
    });
    expect(summarize([ok("unit", HOUR), undefined, partial])).toEqual({
      kind: "never",
      text: "never",
    });
    expect(summarize([ok("unit", HOUR), partial])).toEqual({
      kind: "partial",
      text: "partial",
    });
    expect(
      summarize([ok("unit", 3 * HOUR), ok("integration", 2 * DAY)]),
    ).toEqual({ kind: "ok", text: "2d" });
  });

  it("prefixes ticked over all when only some suites are ticked", () => {
    expect(
      summarize([ok("unit", HOUR), ok("integration", 2 * HOUR)], 3),
    ).toEqual({ kind: "ok", text: "2/3 · 2h" });
  });

  it("reads the running suite, with the count for Mutation, while scanning", () => {
    expect(
      summarize([ok("unit", HOUR)], 3, {
        suite: "unit",
        done: null,
        total: null,
      }),
    ).toEqual({ kind: "running", text: "unit" });
    expect(
      summarize([ok("unit", HOUR)], 3, { suite: "unit", done: 11, total: 29 }),
    ).toEqual({ kind: "running", text: "unit 11/29" });
  });

  it("reads the stage when running with no counts", () => {
    expect(
      summarize([ok("unit", HOUR)], 1, {
        suite: "unit",
        done: null,
        total: null,
        stage: "compiling",
      }).text,
    ).toBe("compiling");
  });

  it("reads running when the running suite has no name and no stage", () => {
    expect(
      summarize([ok("unit", HOUR)], 1, { suite: "", done: null, total: null })
        .text,
    ).toBe("running");
  });

  it("counts a ticked suite with no run time as now in the oldest age", () => {
    const undated: SuiteResult = { name: "web", status: "ok", ranAt: null };

    expect(summarize([ok("unit", 3 * HOUR), undated])).toEqual({
      kind: "ok",
      text: "3h",
    });
    expect(summarize([undated, undated]).text).toBe("now");
  });
});

describe("suite rows", () => {
  const suites = [
    { name: "unit", language: "ts" },
    { name: "integration", language: "py" },
    { name: "web", language: "rs" },
  ];
  const results = [
    suiteStanding(ok("unit", HOUR)),
    suiteStanding(ok("web", 2 * HOUR)),
  ];

  it("lists the suites in config order, one never-run row for a suite with no result", () => {
    const rows = suiteRows({
      sensor: "crap",
      suites,
      ticked: ["unit", "web"],
      results,
      running: null,
      locked: false,
      now: NOW,
      behind: new Map(),
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((one) => one.name)).toEqual(["unit", "integration", "web"]);
    expect(rows.map((one) => one.tag)).toEqual(["ts", "py", "rs"]);
    expect(rows.map((one) => one.ticked)).toEqual([true, false, true]);
    expect(rows.map((one) => one.state.kind)).toEqual(["ok", "never", "ok"]);
    expect(rows.every((one) => one.sensor === "crap")).toBe(true);
    expect(rows.every((one) => !one.disabled)).toBe(true);
  });

  it("disables every row while locked", () => {
    const rows = suiteRows({
      sensor: "crap",
      suites,
      ticked: [],
      results: undefined,
      running: null,
      locked: true,
      now: NOW,
      behind: new Map(),
    });

    expect(rows.length).toBe(3);
    expect(rows.every((one) => one.disabled)).toBe(true);
    expect(rows.every((one) => one.state.kind === "never")).toBe(true);
  });

  it("reads only the suite named by running as running", () => {
    const rows = suiteRows({
      sensor: "crap",
      suites,
      ticked: ["unit"],
      results,
      running: { suite: "integration", done: 1, total: 4 },
      locked: true,
      now: NOW,
      behind: new Map(),
    });

    expect(rows.map((one) => one.state.kind)).toEqual(["ok", "running", "ok"]);
    expect(rows[1]?.state.text).toBe("1/4");
  });
});

describe("ticked results", () => {
  const suites = [
    { name: "unit", language: "ts" },
    { name: "integration", language: "py" },
    { name: "web", language: "rs" },
  ];
  const results = [
    suiteStanding(ok("web", HOUR)),
    suiteStanding(ok("unit", 2 * HOUR)),
  ];

  it("returns standings for ticked suites in config order, undefined where there is none", () => {
    const ticked = tickedResults(
      suites,
      ["web", "integration", "unit"],
      results,
    );

    expect(ticked).toEqual([results[1], undefined, results[0]]);
  });

  it("returns nothing when no suite is ticked", () => {
    expect(tickedResults(suites, [], results)).toEqual([]);
  });
});

describe("suites behind", () => {
  const configured = [
    { name: "root", directory: "" },
    { name: "app", directory: "packages/app" },
  ];
  const files = ["a.ts", "packages/app/b.ts"];

  it("gives a file to the suite whose directory is the longest that contains it", () => {
    const behind = suitesBehind({ suites: configured, files, current: [] });

    expect(behind.get("root")).toBe(1);
    expect(behind.get("app")).toBe(1);
  });

  it("treats an empty directory and a dot as covering every file", () => {
    const dot = [{ name: "all", directory: "." }];

    expect(suitesBehind({ suites: dot, files, current: [] }).get("all")).toBe(
      2,
    );
    expect(
      suitesBehind({
        suites: [configured[0] as never],
        files,
        current: [],
      }).get("root"),
    ).toBe(2);
  });

  it("counts only the files absent from current, never all or none of a mixed set", () => {
    const many = [
      "packages/app/b.ts",
      "packages/app/c.ts",
      "packages/app/d.ts",
    ];
    const behind = suitesBehind({
      suites: configured,
      files: many,
      current: new Set(["packages/app/b.ts"]),
    });

    expect(behind.get("app")).toBe(2);
    expect(behind.get("root")).toBe(0);
  });

  it("returns 0 for a suite covering nothing", () => {
    const behind = suitesBehind({
      suites: [{ name: "web", directory: "web" }],
      files,
      current: [],
    });

    expect(behind.get("web")).toBe(0);
  });

  it("covers a file whose path equals the directory, and ignores a trailing slash and a name that only shares a prefix", () => {
    const behind = suitesBehind({
      suites: [
        { name: "exact", directory: "packages/app/b.ts" },
        { name: "slashed", directory: "packages/app/" },
        { name: "prefix", directory: "packages/ap" },
      ],
      files: ["packages/app/b.ts"],
      current: [],
    });

    expect(behind.get("exact")).toBe(1);
    expect(behind.get("slashed")).toBe(0);
    expect(behind.get("prefix")).toBe(0);
  });

  it("carries stale on exactly the rows whose suite has covered files behind", () => {
    const rows = suiteRows({
      sensor: "crap",
      suites: [
        { name: "root", language: "ts" },
        { name: "app", language: "ts" },
      ],
      ticked: [],
      results: [
        suiteStanding(ok("root", HOUR)),
        suiteStanding(ok("app", HOUR)),
      ],
      running: null,
      locked: false,
      now: NOW,
      behind: new Map([["app", 2]]),
    });

    expect(rows.map((one) => one.state.kind)).toEqual(["ok", "stale"]);
    expect(rows[1]?.state.text).toBe("2 out of date");
  });
});
