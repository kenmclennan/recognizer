import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config-parse.js";
import { REPO } from "./helpers.js";

const RETIRED = "sensors:\n  structure:\n    distance_threshold: 0.5\n";
const BAD_DESCRIBER = "describer:\n  command: []\n";
const SUITE = readFileSync(
  join(REPO, "schema/config-examples/valid/tests-python-activate.yaml"),
  "utf8",
);

describe("parseConfig by section", () => {
  it("validates only the sections read", () => {
    expect(parseConfig(RETIRED, ["describer"])).toEqual({});
    expect(() => parseConfig(RETIRED, ["sensors"])).toThrow(
      "distance_threshold was removed",
    );
    expect(() => parseConfig(RETIRED)).toThrow(
      "distance_threshold was removed",
    );
    expect(parseConfig(BAD_DESCRIBER, ["sensors"])).toEqual({});
  });

  it("refuses top-level keys that are no section only when reading all", () => {
    expect(() => parseConfig("overlays: {}\n", ["sensors"])).not.toThrow();
    expect(() => parseConfig("overlays: {}\n", "all")).toThrow("overlays");
    expect(() => parseConfig("bogus: 1\n", ["sensors"])).not.toThrow();
    expect(() => parseConfig("bogus: 1\n")).toThrow();
  });

  it("refuses invalid YAML on a non-empty read and never parses an empty one", () => {
    expect(() => parseConfig("a: [\n", ["describer"])).toThrow(
      "not valid YAML",
    );
    expect(parseConfig("a: [\n", [])).toEqual({});
  });

  it("reads tests whenever sensors is read", () => {
    const text = `sensors:\n  crap: {}\n${SUITE}`;
    const crap = parseConfig(text, ["sensors"]).sensors?.crap as {
      command: string[];
    };

    expect(crap.command.join(" ")).toContain("api");
    expect(parseConfig(text, ["tests"]).sensors).toBeUndefined();
    expect(parseConfig(text, ["tests"]).tests).toHaveLength(1);
  });

  it("applies the duplicate suite reject only when tests is read", () => {
    const twice = `${SUITE}${SUITE.replace("tests:\n", "")}`;

    expect(() => parseConfig(twice, ["sensors"])).toThrow(
      "the test suite name api is used twice",
    );
    expect(parseConfig(twice, ["describer"])).toEqual({});
  });
});
