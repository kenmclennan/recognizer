import { describe, expect, it } from "vitest";
import {
  buildCatalog,
  EMPTY_CATALOG,
  groupKeyOf,
} from "../../src/finding-catalog";
import { installedSensors, plainSensor } from "../../src/installed-fake";

const REAL = buildCatalog({ status: "ok", sensors: installedSensors() });

describe("groupKeyOf", () => {
  it.each([
    ["crap", "kind:crap"],
    ["mutation", "kind:mutation"],
    ["other.<metric>", "kind:other"],
    ["a.b.<c>.d", "kind:a.b"],
    ["<x>", "kind:"],
  ])("reads %s as %s", (pattern, key) => {
    expect(groupKeyOf(pattern)).toBe(key);
  });
});

describe("buildCatalog", () => {
  it("builds one group per findings entry in list order with the keys the code used", () => {
    expect(REAL.groups.map((g) => [g.key, g.sensor, g.pattern])).toEqual([
      ["kind:crap", "crap", "crap"],
      ["kind:coverage", "crap", "coverage"],
      ["kind:mutation", "mutation", "mutation"],
    ]);
    expect(REAL.groups.map((g) => g.name)).toEqual([
      "C.R.A.P.",
      "Low coverage",
      "Mutations",
    ]);
  });

  it("matches a placeholder segment against any one non-empty segment", () => {
    const group = {
      kind: "other.<metric>",
      group: { name: "Other", means: "m", todo: "t" },
      help: "h",
      sentence: { requires: [], parts: [] },
    };
    const catalog = buildCatalog({
      status: "ok",
      sensors: [plainSensor("other", { findings: [group] })],
    });

    expect(catalog.groupFor("other.complexity")?.key).toBe("kind:other");
    expect(catalog.groupFor("other.churn")?.key).toBe("kind:other");
    expect(catalog.groupFor("other")).toBeUndefined();
    expect(catalog.groupFor("other.")).toBeUndefined();
    expect(catalog.groupFor("other.a.b")).toBeUndefined();
    expect(REAL.groupFor("crap.extra")).toBeUndefined();
  });

  it("names the sensor that owns a key", () => {
    expect(REAL.sensorOf("kind:mutation")).toBe("mutation");
    expect(REAL.sensorOf("kind:cycle")).toBeUndefined();
  });

  it("is empty for a null or unavailable list and for sensors with no findings", () => {
    expect(EMPTY_CATALOG.groups).toEqual([]);
    expect(buildCatalog(null).groups).toEqual([]);
    expect(buildCatalog({ status: "unavailable", reason: "x" }).groups).toEqual(
      [],
    );
    expect(
      buildCatalog({ status: "ok", sensors: [plainSensor("p")] }).groups,
    ).toEqual([]);
  });
});
