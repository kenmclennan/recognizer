import { describe, expect, it } from "vitest";
import {
  manifestFix,
  notMeasuredLine,
  undeclaredSensors,
} from "../src/index.js";

const SENSE = ["recognizer", "sense", ""].join("-");

const WITH_MANIFEST = {
  name: "declared",
  command: ["python3", "sense.py", "run"],
  manifest: ["python3", "sense.py", "manifest"],
};
const PLUGIN = { name: "mine", command: [`${SENSE}mine`, "run"] };
const CUSTOM = { name: "make-run", command: ["make", "run"] };

describe("undeclaredSensors", () => {
  it("returns one record per sensor without a manifest, in input order", () => {
    const found = undeclaredSensors([CUSTOM, WITH_MANIFEST, PLUGIN], true);

    expect(found.map((one) => one.name)).toEqual(["make-run", "mine"]);
  });

  it("returns nothing for a sensor that has a manifest", () => {
    expect(undeclaredSensors([WITH_MANIFEST], true)).toEqual([]);
  });

  it("holds suites back exactly when suites are configured", () => {
    expect(undeclaredSensors([PLUGIN], true)[0]?.suitesWithheld).toBe(true);
    expect(undeclaredSensors([PLUGIN], false)[0]?.suitesWithheld).toBe(false);
  });

  it("builds the plugin fix from the program and the doctor shares it", () => {
    const [found] = undeclaredSensors([PLUGIN], true);
    const fix = manifestFix("mine", PLUGIN.command);

    expect(found?.fix).toBe(fix);
    expect(fix).toBe(
      `recognizer config --add sensors.mine.manifest ${SENSE}mine && recognizer config --add sensors.mine.manifest manifest`,
    );
    expect(found?.line).toBe(
      `mine declares nothing until its manifest is added (no suites, no scope, no check): ${fix}`,
    );
  });

  it("never guesses a manifest command for another program", () => {
    const [found] = undeclaredSensors([CUSTOM], true);

    expect(found?.fix).toContain("<first word>");
    expect(found?.fix).toContain("<next word>");
    expect(found?.fix).not.toContain("make manifest");
    expect(found?.fix).not.toMatch(/manifest make/);
  });

  it("names the not-measured wording exactly", () => {
    expect(notMeasuredLine("mine")).toBe(
      "not measured mine: the configured suites were not handed to it",
    );
  });
});
