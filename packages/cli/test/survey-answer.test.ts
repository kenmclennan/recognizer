import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import validate from "../src/generated/survey-answer-validator.js";
import { REPO } from "./helpers.js";

const EXAMPLES = join(REPO, "schema/survey-answer-examples");

function load(kind: string, name: string): unknown {
  return JSON.parse(readFileSync(join(EXAMPLES, kind, name), "utf8"));
}

describe("survey answer: examples", () => {
  it("holds the expected count of examples", () => {
    expect(readdirSync(join(EXAMPLES, "valid"))).toHaveLength(4);
    expect(readdirSync(join(EXAMPLES, "invalid"))).toHaveLength(7);
  });

  it.each(readdirSync(join(EXAMPLES, "valid")))("accepts %s", (file) => {
    expect(validate(load("valid", file))).toBe(true);
  });

  it.each(readdirSync(join(EXAMPLES, "invalid")))("rejects %s", (file) => {
    expect(validate(load("invalid", file))).toBe(false);
  });
});
