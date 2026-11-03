import { describe, expect, it } from "vitest";
import { loadedUnchanged } from "./loaded-unchanged";
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
