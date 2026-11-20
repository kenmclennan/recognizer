import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";

const EXAMPLES = join(REPO, "schema/suite-record-examples");

const schema = JSON.parse(
  readFileSync(join(REPO, "schema/suite-record.schema.json"), "utf8"),
);
const validate = new Ajv2020({ allErrors: true }).compile(schema);

function accepts(folder: string, file: string): boolean {
  return validate(
    JSON.parse(readFileSync(join(EXAMPLES, folder, file), "utf8")),
  );
}

describe("suite record schema examples", () => {
  it("has examples on both sides", () => {
    expect(readdirSync(join(EXAMPLES, "valid")).length).toBeGreaterThan(0);
    expect(readdirSync(join(EXAMPLES, "invalid")).length).toBeGreaterThan(0);
  });

  it.each(readdirSync(join(EXAMPLES, "valid")))("accepts %s", (file) => {
    expect(accepts("valid", file)).toBe(true);
  });

  it.each(readdirSync(join(EXAMPLES, "invalid")))("rejects %s", (file) => {
    expect(accepts("invalid", file)).toBe(false);
  });
});
