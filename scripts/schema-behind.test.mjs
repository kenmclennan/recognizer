import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { behindMessage, run, schemaVersion } from "./schema-behind.mjs";

const versions = { "origin/main": 6, lower: 5, equal: 6, higher: 7 };
const versionOf = (ref) => versions[ref];

describe("schema-behind", () => {
  it("fails a branch on a lower schema with the rebase message", () => {
    expect(run(["origin/main", "lower"], versionOf)).toEqual({
      code: 1,
      output: "main is on scan schema 6, this branch is on 5: rebase onto main",
    });
  });

  it("passes a branch on the same schema", () => {
    expect(run(["origin/main", "equal"], versionOf).code).toBe(0);
  });

  it("passes a branch on a higher schema", () => {
    expect(run(["origin/main", "higher"], versionOf).code).toBe(0);
  });

  it("compares plain versions for the push job", () => {
    expect(run(["--versions", "6", "5"]).code).toBe(1);
    expect(run(["--versions", "6", "6"]).code).toBe(0);
    expect(behindMessage(6, 7)).toBeNull();
  });

  it("rejects missing arguments", () => {
    expect(run([]).code).toBe(2);
  });

  it("reads the const from the scan schema", () => {
    const text = readFileSync(
      join(import.meta.dirname, "..", "schema", "scan.schema.json"),
      "utf8",
    );

    expect(Number.isInteger(schemaVersion(text))).toBe(true);
    expect(() => schemaVersion("{}")).toThrow(/schema_version/);
  });

  it("exits 1 from the command line when behind", () => {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
    const result = spawnSync(
      "node",
      [join(root, "scripts", "schema-behind.mjs"), "--versions", "6", "5"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("rebase onto main");
  });
});
