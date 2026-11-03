import { describe, expect, it } from "vitest";
import { inertScanHost } from "./explorer";
import { loadedOf, registeredOf, scanHostOf } from "./look-support";

describe("look-support", () => {
  it("loadedOf carries every key of a Loaded", () => {
    expect(Object.keys(loadedOf()).sort()).toEqual(
      [
        "baseline",
        "blocking",
        "findings",
        "modules",
        "notices",
        "policy",
        "scans",
        "sensors",
      ].sort(),
    );
  });

  it("loadedOf lets an override win over the base", () => {
    const loaded = loadedOf({ modules: ["a.py"], blocking: "stop" });

    expect(loaded.modules).toEqual(["a.py"]);
    expect(loaded.blocking).toBe("stop");
    expect(loaded.notices).toEqual([]);
  });

  it("scanHostOf equals the inert scan host shape", () => {
    expect(Object.keys(scanHostOf()).sort()).toEqual(
      Object.keys(inertScanHost).sort(),
    );
  });

  it("scanHostOf lets an override win", () => {
    const run = () => {};

    expect(scanHostOf({ run }).run).toBe(run);
    expect(scanHostOf({ run }).stop).toBe(inertScanHost.stop);
  });

  it("registeredOf drops display and title", () => {
    expect(
      registeredOf([
        { name: "crap", display: "CRAP", title: "t", runsTests: true },
      ]),
    ).toEqual([{ name: "crap", runsTests: true }]);
  });
});
