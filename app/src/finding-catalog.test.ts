import { describe, expect, it } from "vitest";
import { buildCatalog, EMPTY_CATALOG, groupKeyOf } from "./finding-catalog";
import { plainSensor, shippedSensors } from "./shipped-fake";

const REAL = buildCatalog({ status: "ok", sensors: shippedSensors() });

describe("groupKeyOf", () => {
  it.each([
    ["crap", "kind:crap"],
    ["mutation", "kind:mutation"],
    ["thresholds.<metric>", "kind:thresholds"],
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
      ["kind:mutation", "mutation", "mutation"],
      ["kind:thresholds", "thresholds", "thresholds.<metric>"],
    ]);
    expect(REAL.groups.map((g) => g.name)).toEqual([
      "C.R.A.P.",
      "Mutations",
      "Over a limit",
    ]);
  });

  it("matches a placeholder segment against any one non-empty segment", () => {
    expect(REAL.groupFor("thresholds.complexity")?.key).toBe("kind:thresholds");
    expect(REAL.groupFor("thresholds.churn")?.key).toBe("kind:thresholds");
    expect(REAL.groupFor("thresholds")).toBeUndefined();
    expect(REAL.groupFor("thresholds.")).toBeUndefined();
    expect(REAL.groupFor("thresholds.a.b")).toBeUndefined();
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
