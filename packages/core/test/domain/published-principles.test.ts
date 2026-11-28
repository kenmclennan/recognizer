import { describe, expect, it } from "vitest";
import type { InstalledPlugin } from "../../src/domain/plugins/installed-plugin.js";
import type { PluginKind } from "../../src/domain/plugins/manifest.js";
import {
  mergePublishedPrinciples,
  publishedPrinciplesOf,
} from "../../src/domain/plugins/published-principles.js";
import type { Principle } from "../../src/domain/principles.js";

function plugin(
  kind: PluginKind,
  name: string,
  principles?: Principle[],
): InstalledPlugin {
  return {
    kind,
    name,
    command: `recognizer-${name}`,
    manifest: {
      kind,
      name,
      ...(principles === undefined ? {} : { principles }),
    } as InstalledPlugin["manifest"],
    judgement: "current",
    schema: "current",
  };
}

const first = { id: "one", name: "One" };
const second = { id: "two", name: "Two" };
const third = { id: "three", name: "Three" };

describe("publishedPrinciplesOf", () => {
  it("orders sensors by plugin name whatever the input order", () => {
    const found = publishedPrinciplesOf([
      plugin("sensor", "mutation", [second]),
      plugin("sensor", "crap", [first]),
    ]);

    expect(found).toEqual([first, second]);
  });

  it("takes nothing from a sensor that publishes none", () => {
    expect(
      publishedPrinciplesOf([
        plugin("sensor", "bare"),
        plugin("sensor", "crap", [first]),
      ]),
    ).toEqual([first]);
  });

  it("skips a scanner that carries principles", () => {
    expect(
      publishedPrinciplesOf([
        plugin("scanner", "python", [first]),
        plugin("describer", "claude", [second]),
      ]),
    ).toEqual([]);
  });

  it("merges three sensors, keeping the first entry of a repeated id", () => {
    const found = publishedPrinciplesOf([
      plugin("sensor", "zeta", [third]),
      plugin("sensor", "beta", [{ id: "one", name: "Repeated" }]),
      plugin("sensor", "alpha", [first, second]),
      plugin("sensor", "bare"),
    ]);

    expect(found).toEqual([first, second, third]);
  });
});

describe("mergePublishedPrinciples", () => {
  it("merges_named_sources_in_name_order", () => {
    const later = { id: "one", name: "Later One" };
    const found = mergePublishedPrinciples([
      { name: "zeta", principles: [later, third] },
      { name: "bare" },
      { name: "alpha", principles: [first, second] },
    ]);

    expect(found).toEqual([first, second, third]);
    expect(found.filter((one) => one.id === "one")).toHaveLength(1);
  });
});
