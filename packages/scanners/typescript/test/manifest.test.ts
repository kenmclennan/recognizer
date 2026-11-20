import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../../scripts/temp-dirs.mjs";
import { PROTOCOL } from "../src/manifest.js";
import { BIN, REPO, scanTree } from "./helpers.js";

const validate = new Ajv2020({ allErrors: true }).compile(
  JSON.parse(readFileSync(join(REPO, "schema/manifest.schema.json"), "utf8")),
);

function manifest(cwd: string) {
  return spawnSync("node", [BIN, "manifest"], { cwd, encoding: "utf8" });
}

describe("the manifest verb", () => {
  it("holds the protocol of schema/protocol.json", () => {
    const shared = JSON.parse(
      readFileSync(join(REPO, "schema/protocol.json"), "utf8"),
    );

    expect(shared).toEqual({ protocol: PROTOCOL });
  });

  it("prints a valid manifest and a newline, exits 0 and writes nothing to stderr", () => {
    const result = manifest(makeTempDir("manifest-"));

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.endsWith("\n")).toBe(true);
    expect(validate(JSON.parse(result.stdout))).toBe(true);
  });

  it("prints the same manifest from another working directory and touches nothing", () => {
    const here = makeTempDir("manifest-");
    const elsewhere = makeTempDir("manifest-");

    expect(manifest(here).stdout).toBe(manifest(elsewhere).stdout);
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("answers --version as before", () => {
    const result = spawnSync("node", [BIN, "--version"], { encoding: "utf8" });

    expect(result.stdout.trim()).toBe(
      JSON.parse(
        readFileSync(
          join(REPO, "packages/scanners/typescript/package.json"),
          "utf8",
        ),
      ).version,
    );
  });

  it("declares the scan schema version of the schema and of the scan it writes", () => {
    const declared = JSON.parse(
      manifest(makeTempDir("manifest-")).stdout,
    ).scan_schema_version;
    const constant = JSON.parse(
      readFileSync(join(REPO, "schema/scan.schema.json"), "utf8"),
    ).properties.schema_version.const;

    expect(declared).toBeDefined();
    expect(declared).toBe(constant);
    expect(declared).toBe(
      scanTree({ "a.ts": "export const a = 1;\n" }).schema_version,
    );
  });
});
