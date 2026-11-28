import {
  UNREGISTERED_FIX,
  unregisteredSensors as unregistered,
  unregisteredMessage,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";

const INSTALLED = ["crap", "mutation"];

const unregisteredSensors = (
  registered: readonly string[],
  requested: readonly string[],
) => unregistered(registered, requested, INSTALLED);

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
  it("returns the installed names that are not registered, once each, in request order", () => {
    expect(
      unregisteredSensors(["mutation"], ["crap", "mutation", "crap"]),
    ).toEqual(["crap"]);
  });

  it("returns nothing when every requested sensor is registered", () => {
    expect(
      unregisteredSensors(["crap", "mutation"], ["crap", "mutation"]),
    ).toEqual([]);
  });

  it("returns every requested installed name when none is registered", () => {
    expect(unregisteredSensors([], ["mutation", "crap"])).toEqual([
      "mutation",
      "crap",
    ]);
  });

  it("never returns a name that is not installed", () => {
    expect(unregisteredSensors([], ["custom"])).toEqual([]);
  });

  it("does not count a sensor registered under another key as registering crap", () => {
    expect(unregisteredSensors(["mycrap"], ["crap"])).toEqual(["crap"]);
  });
});
