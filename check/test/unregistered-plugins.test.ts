import { describe, expect, it } from "vitest";
import { InputError } from "../src/errors.js";
import {
  refuseUnregistered,
  UNREGISTERED_FIX,
  unregisteredMessage,
  unregisteredSensors,
} from "../src/unregistered-plugins.js";

function refusal(registered: string[], requested: string[]): string[] | null {
  try {
    refuseUnregistered(registered, requested);
  } catch (error) {
    return (error as InputError).messages;
  }

  return null;
}

describe("refuseUnregistered", () => {
  it("refuses only the unregistered shipped names, once each, in request order", () => {
    expect(
      refusal(["crap"], ["crap", "mutation", "thresholds", "mutation"]),
    ).toEqual([
      unregisteredMessage("mutation"),
      unregisteredMessage("thresholds"),
    ]);
  });

  it("does not throw when every requested sensor is registered", () => {
    expect(refusal(["crap", "mutation"], ["crap", "mutation"])).toBeNull();
  });

  it("gives one line per requested shipped name when none is registered", () => {
    expect(refusal([], ["thresholds", "crap"])).toEqual([
      unregisteredMessage("thresholds"),
      unregisteredMessage("crap"),
    ]);
  });

  it("never names a requested sensor that is not shipped", () => {
    expect(refusal([], ["custom"])).toBeNull();
  });

  it("throws an InputError", () => {
    expect(() => refuseUnregistered([], ["crap"])).toThrow(InputError);
  });
});

describe("unregisteredMessage", () => {
  it("fills the name into the binding text", () => {
    expect(unregisteredMessage("crap")).toBe(
      "crap is not registered in .recognizer/config.yaml; register it with `recognizer plugin add crap`.",
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
