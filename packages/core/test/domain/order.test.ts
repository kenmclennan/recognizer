import { describe, expect, it } from "vitest";
import { CORE_ENTRIES, comparePlugins } from "../../src/index.js";

const plugin = (name: string, display: string) => ({ name, display });

describe("comparePlugins", () => {
  it("orders Zed, C.R.A.P. and claude by display ignoring case", () => {
    const ordered = [
      plugin("zed", "Zed"),
      plugin("crap", "C.R.A.P."),
      plugin("claude", "claude"),
    ].sort(comparePlugins);

    expect(ordered.map((one) => one.display)).toEqual([
      "C.R.A.P.",
      "claude",
      "Zed",
    ]);
  });

  it("breaks a tie on the display by the name", () => {
    const ordered = [plugin("b", "Same"), plugin("a", "same")].sort(
      comparePlugins,
    );

    expect(ordered.map((one) => one.name)).toEqual(["a", "b"]);
  });

  it("orders by display and not by program name", () => {
    const ordered = [plugin("alpha", "Zeta"), plugin("zeta", "Alpha")].sort(
      comparePlugins,
    );

    expect(ordered.map((one) => one.name)).toEqual(["zeta", "alpha"]);
  });
});

describe("CORE_ENTRIES", () => {
  it("lists structure, analysis and suites in that fixed order", () => {
    expect([...CORE_ENTRIES]).toEqual(["structure", "analysis", "suites"]);
  });

  it("puts the core entries ahead of every plugin in a list built by the rule", () => {
    const plugins = [plugin("b", "Beta"), plugin("a", "Alpha")].sort(
      comparePlugins,
    );
    const list = [...CORE_ENTRIES, ...plugins.map((one) => one.name)];

    expect(list).toEqual(["structure", "analysis", "suites", "a", "b"]);
  });
});
