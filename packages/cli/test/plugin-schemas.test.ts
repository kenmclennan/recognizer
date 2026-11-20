import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import validateCheck from "../src/generated/check-validator.js";
import validateEvent from "../src/generated/events-validator.js";
import validateManifest from "../src/generated/manifest-validator.js";
import { REPO } from "./helpers.js";

const SUITES = [
  {
    name: "manifest",
    folder: "schema/manifest-examples",
    validate: validateManifest,
  },
  { name: "event", folder: "schema/events-examples", validate: validateEvent },
  { name: "check", folder: "schema/check-examples", validate: validateCheck },
];

function files(folder: string, kind: string): string[] {
  return readdirSync(join(REPO, folder, kind)).filter((name) =>
    name.endsWith(".json"),
  );
}

function load(folder: string, kind: string, name: string): unknown {
  return JSON.parse(readFileSync(join(REPO, folder, kind, name), "utf8"));
}

describe.each(SUITES)("$name schema examples", ({ folder, validate }) => {
  it("has valid and invalid examples to check", () => {
    expect(files(folder, "valid").length).toBeGreaterThan(0);
    expect(files(folder, "invalid").length).toBeGreaterThan(0);
  });

  it.each(files(folder, "valid"))("accepts valid/%s", (name) => {
    expect(validate(load(folder, "valid", name))).toBe(true);
  });

  it.each(files(folder, "invalid"))("rejects invalid/%s", (name) => {
    expect(validate(load(folder, "invalid", name))).toBe(false);
  });
});

describe("the manifest schema", () => {
  it("copies the settings entry shape of config-keys.schema.json", () => {
    const manifest = JSON.parse(
      readFileSync(join(REPO, "schema/manifest.schema.json"), "utf8"),
    );
    const keys = JSON.parse(
      readFileSync(join(REPO, "schema/config-keys.schema.json"), "utf8"),
    );

    const display = ["label", "labels", "unit", "units", "order", "limit"];
    const {
      properties: { ...shown },
      not: { anyOf: exclusives },
      ...rest
    } = manifest.$defs.setting;

    for (const name of display) {
      delete shown[name];
    }

    expect({
      ...rest,
      properties: shown,
      not: { anyOf: exclusives.slice(0, 3) },
    }).toEqual(keys.properties.keys.items);
    expect(exclusives).toHaveLength(5);
  });

  it("holds the protocol the CLI judges against", () => {
    const protocol = JSON.parse(
      readFileSync(join(REPO, "schema/protocol.json"), "utf8"),
    );

    expect(protocol).toEqual({ protocol: 1 });
  });
});
