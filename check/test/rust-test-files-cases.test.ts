import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import { nodeIo } from "../src/cli.js";
import { rustTestFiles } from "../src/rust-test-blocks.js";

type FileCase = {
  name: string;
  files: Record<string, string>;
  test_files: string[];
};

const CASES = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../../fixtures/rust-test-gate/file-cases.json"),
    "utf8",
  ),
) as FileCase[];

describe("rustTestFiles against the shared file cases", () => {
  it("reads a table with more than fifteen cases", () => {
    expect(CASES.length).toBeGreaterThan(15);
  });

  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, entry) => {
    const root = makeTempDir("recognizer-test-files-");

    for (const [path, text] of Object.entries(entry.files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }

    const found = rustTestFiles(nodeIo(), root, Object.keys(entry.files));

    expect([...found].sort()).toEqual([...entry.test_files].sort());
  });
});
