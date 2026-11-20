import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type DescribeAnswer, parseAnswer } from "../src/scan-answer.js";
import { REPO } from "./helpers.js";

const EXAMPLES = join(REPO, "schema/scan-answer-examples");

describe("scan answer: examples", () => {
  it("holds the expected count of examples", () => {
    expect(readdirSync(join(EXAMPLES, "valid"))).toHaveLength(2);
    expect(readdirSync(join(EXAMPLES, "invalid"))).toHaveLength(4);
  });

  it.each(readdirSync(join(EXAMPLES, "valid")))("accepts %s", (file) => {
    const text = readFileSync(join(EXAMPLES, "valid", file), "utf8");

    expect(parseAnswer(text)).toEqual(JSON.parse(text) as DescribeAnswer);
  });

  it.each(readdirSync(join(EXAMPLES, "invalid")))("rejects %s", (file) => {
    expect(
      parseAnswer(readFileSync(join(EXAMPLES, "invalid", file), "utf8")),
    ).toBeNull();
  });

  it("rejects text that is not JSON", () => {
    expect(parseAnswer("{")).toBeNull();
  });
});
