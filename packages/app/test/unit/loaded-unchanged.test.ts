import { Repository } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { loadedUnchanged, sameStructure } from "../../src/loaded-unchanged";
import type { Loaded } from "../../src/scan-loading";
import { repositoryFrom } from "./repository-from";

const BASE: Loaded = {
  modules: [],
  scans: [],
  repository: Repository.empty,
  policy: [],
  baseline: ["b"],
  notices: [],
  blocking: null,
  findings: [],
  sensors: [],
  overlays: [{ name: "coverage", overlay: {} as never }],
  overlaysUnreadable: [],
};

describe("loadedUnchanged", () => {
  it("is false when nothing was replaced yet", () => {
    expect(loadedUnchanged(null, BASE)).toBe(false);
  });

  it("is true for equal sensed fields, whatever the scans are", () => {
    const scans = [{ file: "scan.python.json", repository: Repository.empty }];

    expect(loadedUnchanged(BASE, { ...BASE })).toBe(true);
    expect(loadedUnchanged(BASE, { ...BASE, scans })).toBe(true);
  });

  it.each([
    ["policy", { policy: null }],
    ["baseline", { baseline: null }],
    ["findings", { findings: [{ sensor: "x" } as never] }],
    ["sensors", { sensors: [{ name: "x" } as never] }],
    ["overlays", { overlays: [] }],
    ["overlaysUnreadable", { overlaysUnreadable: ["x"] }],
    ["tests", { tests: "x" }],
  ])("is false when %s differs", (_name, change) => {
    expect(loadedUnchanged(BASE, { ...BASE, ...change })).toBe(false);
  });
});

describe("loadedUnchanged tests digest", () => {
  it("is false when only the tests digest differs", () => {
    expect(
      loadedUnchanged({ ...BASE, tests: "t1" }, { ...BASE, tests: "t2" }),
    ).toBe(false);
  });

  it("is true when the digests are equal or both absent", () => {
    expect(
      loadedUnchanged({ ...BASE, tests: "t1" }, { ...BASE, tests: "t1" }),
    ).toBe(true);
    expect(loadedUnchanged({ ...BASE }, { ...BASE })).toBe(true);
  });
});

describe("sameStructure", () => {
  const scan = {
    file: "scan.python.json",
    repository: repositoryFrom([{ modules: [], edges: [], commit: "c1" }]),
  };
  const WITH_SCAN: Loaded = { ...BASE, modules: ["a.py"], scans: [scan] };

  it("is false when nothing was applied yet", () => {
    expect(sameStructure(null, BASE)).toBe(false);
  });

  it("is true when only sensed data differs", () => {
    expect(
      sameStructure(WITH_SCAN, {
        ...WITH_SCAN,
        policy: null,
        baseline: null,
        findings: [{ sensor: "x" } as never],
        sensors: [{ name: "x" } as never],
        overlays: [],
        notices: ["n"],
      }),
    ).toBe(true);
  });

  it.each([
    ["modules", { modules: ["a.py", "b.py"] }],
    [
      "a scan document",
      { scans: [{ ...scan, scan: { commit: "c1", x: 1 } as never }] },
    ],
    [
      "a scan commit",
      {
        scans: [
          {
            ...scan,
            repository: repositoryFrom([
              { modules: [], edges: [], commit: "c2" },
            ]),
          },
        ],
      },
    ],
  ])("is false when %s differs", (_name, change) => {
    expect(sameStructure(WITH_SCAN, { ...WITH_SCAN, ...change })).toBe(false);
  });
});
