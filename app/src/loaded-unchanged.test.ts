import { describe, expect, it } from "vitest";
import { loadedUnchanged, sameStructure } from "./loaded-unchanged";
import type { Loaded } from "./scan-loading";

const BASE: Loaded = {
  modules: [],
  scans: [],
  policy: "p",
  baseline: "b",
  notices: [],
  blocking: null,
  findings: [],
  sensors: [],
  overlays: [{ name: "coverage", text: "{}" }],
  overlaysUnreadable: [],
};

describe("loadedUnchanged", () => {
  it("is false when nothing was replaced yet", () => {
    expect(loadedUnchanged(null, BASE)).toBe(false);
  });

  it("is true for equal sensed fields, whatever the scans are", () => {
    const scans = [{ file: "scan.python.json", scan: {} as never }];

    expect(loadedUnchanged(BASE, { ...BASE })).toBe(true);
    expect(loadedUnchanged(BASE, { ...BASE, scans })).toBe(true);
  });

  it.each([
    ["policy", { policy: "q" }],
    ["baseline", { baseline: null }],
    ["findings", { findings: [{ sensor: "x" } as never] }],
    ["sensors", { sensors: [{ name: "x" } as never] }],
    ["overlays", { overlays: [] }],
    ["overlaysUnreadable", { overlaysUnreadable: ["x"] }],
  ])("is false when %s differs", (_name, change) => {
    expect(loadedUnchanged(BASE, { ...BASE, ...change })).toBe(false);
  });
});

describe("sameStructure", () => {
  const scan = { file: "scan.python.json", scan: { commit: "c1" } as never };
  const WITH_SCAN: Loaded = { ...BASE, modules: ["a.py"], scans: [scan] };

  it("is false when nothing was applied yet", () => {
    expect(sameStructure(null, BASE)).toBe(false);
  });

  it("is true when only sensed data differs", () => {
    expect(
      sameStructure(WITH_SCAN, {
        ...WITH_SCAN,
        policy: "q",
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
      { scans: [{ ...scan, scan: { commit: "c2" } as never }] },
    ],
  ])("is false when %s differs", (_name, change) => {
    expect(sameStructure(WITH_SCAN, { ...WITH_SCAN, ...change })).toBe(false);
  });
});
