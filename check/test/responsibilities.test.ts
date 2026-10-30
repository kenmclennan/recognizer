import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseConfig } from "../src/config-parse.js";
import { InputError } from "../src/errors.js";
import {
  lineStatus,
  validateResponsibilities,
} from "../src/responsibilities.js";
import { REPO } from "./helpers.js";

const EXAMPLES = join(REPO, "schema/responsibilities-examples");
const CONFIGS = join(REPO, "schema/config-examples");
const HASH = "a".repeat(64);
const entry = {
  line: "Places orders.",
  source_hash: HASH,
  describer: ["node", "x"],
  version: "v1",
};

describe("validateResponsibilities", () => {
  it.each(readdirSync(join(EXAMPLES, "valid")))("accepts %s", (file) => {
    const value = JSON.parse(
      readFileSync(join(EXAMPLES, "valid", file), "utf8"),
    );

    expect(validateResponsibilities(value)).toEqual(value);
  });

  it.each(readdirSync(join(EXAMPLES, "invalid")))("rejects %s", (file) => {
    const value = JSON.parse(
      readFileSync(join(EXAMPLES, "invalid", file), "utf8"),
    );

    expect(() => validateResponsibilities(value)).toThrow(InputError);
  });
});

describe("config schema examples", () => {
  const validate = new Ajv2020({ allErrors: true }).compile(
    JSON.parse(readFileSync(join(REPO, "schema/config.schema.json"), "utf8")),
  );

  it.each(readdirSync(join(CONFIGS, "valid")))("accepts %s", (file) => {
    const value = parse(readFileSync(join(CONFIGS, "valid", file), "utf8"));

    expect(validate(value)).toBe(true);
  });

  it.each(readdirSync(join(CONFIGS, "invalid")))("rejects %s", (file) => {
    const text = readFileSync(join(CONFIGS, "invalid", file), "utf8");

    if (file === "bad-yaml.yaml") {
      expect(() => parse(text)).toThrow();
    } else {
      expect(validate(parse(text))).toBe(false);
    }
  });
});

describe("lineStatus", () => {
  it("is missing without an entry", () => {
    expect(lineStatus(undefined, HASH, ["node", "x"], "v1")).toEqual({
      status: "missing",
    });
  });

  it("is current while hash, describer and version match", () => {
    expect(lineStatus(entry, HASH, ["node", "x"], "v1")).toEqual({
      status: "current",
    });
  });

  it("lists every differing reason in order", () => {
    expect(lineStatus(entry, "b".repeat(64), ["node", "y"], "v2")).toEqual({
      status: "out-of-date",
      reasons: ["source", "describer", "version"],
    });
  });
});

describe("parseConfig", () => {
  it.each(readdirSync(join(CONFIGS, "valid")))("parses %s", (file) => {
    const text = readFileSync(join(CONFIGS, "valid", file), "utf8");

    expect(parseConfig(text)).toEqual(parse(text) ?? {});
  });

  it.each(readdirSync(join(CONFIGS, "invalid")))("rejects %s", (file) => {
    const text = readFileSync(join(CONFIGS, "invalid", file), "utf8");

    expect(() => parseConfig(text)).toThrow(InputError);
  });
});
