import { describe, expect, it } from "vitest";
import {
  UNREGISTERED_FIX,
  unregisteredSensors,
  unregisteredWarning,
} from "../src/unregistered-plugins.js";

describe("unregisteredWarning", () => {
  it("fills the name into the binding text", () => {
    expect(unregisteredWarning("crap")).toBe(
      "crap is not registered in .recognizer/config.yaml; register it with `recognizer plugin add crap`. From the next release an unregistered plugin will not run.",
    );
  });

  it("names the fix command", () => {
    expect(UNREGISTERED_FIX("claude")).toBe("recognizer plugin add claude");
  });
});

describe("unregisteredSensors", () => {
  it("returns the shipped names that are not registered, once each, in request order", () => {
    expect(
      unregisteredSensors(
        ["crap"],
        ["crap", "mutation", "thresholds", "mutation"],
      ),
    ).toEqual(["mutation", "thresholds"]);
  });

  it("returns nothing when every requested sensor is registered", () => {
    expect(
      unregisteredSensors(["crap", "mutation"], ["crap", "mutation"]),
    ).toEqual([]);
  });

  it("returns every requested shipped name when none is registered", () => {
    expect(unregisteredSensors([], ["thresholds", "crap", "mutation"])).toEqual(
      ["thresholds", "crap", "mutation"],
    );
  });

  it("never returns a name that is not shipped", () => {
    expect(unregisteredSensors([], ["custom"])).toEqual([]);
  });

  it("does not count a sensor registered under another key as registering crap", () => {
    expect(unregisteredSensors(["mycrap"], ["crap"])).toEqual(["crap"]);
  });
});
