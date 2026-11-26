import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import { PROTOCOL } from "../src/manifest.js";
import { promptVersion } from "../src/prompt.js";
import { BIN, REPO } from "./helpers.js";

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
    expect(PROTOCOL).toBe(4);
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

  it("explains itself in one plain sentence", () => {
    expect(JSON.parse(manifest(makeTempDir("manifest-")).stdout)).toMatchObject(
      {
        description:
          "Writes a one-line description of each file with Claude, only when you ask, using your Claude account.",
      },
    );
  });

  it("names the version of the prompt file", () => {
    const printed = promptVersion();

    expect(JSON.parse(manifest(makeTempDir("manifest-")).stdout)).toMatchObject(
      {
        prompt_version: printed,
        version: JSON.parse(
          readFileSync(
            join(REPO, "packages/describers/claude/package.json"),
            "utf8",
          ),
        ).version,
      },
    );
  });

  it("prices haiku, sonnet and opus and validates against the schema", () => {
    const printed = JSON.parse(manifest(makeTempDir("manifest-")).stdout);

    expect(printed.prices).toEqual({
      haiku: { input: 0.1, output: 0.5 },
      sonnet: { input: 2, output: 10 },
      opus: { input: 4, output: 20 },
    });
    expect(validate(printed)).toBe(true);
  });

  it("publishes the model as a machine setting with the default haiku", () => {
    const printed = JSON.parse(manifest(makeTempDir("manifest-")).stdout);

    expect(printed.settings).toEqual([
      expect.objectContaining({
        key: "model",
        type: "string",
        scope: "machine",
        label: "Model",
        default: "haiku",
        order: 1,
      }),
    ]);
  });
});
