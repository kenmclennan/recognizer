import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  readScanFile,
  readUncheckedScanFile,
} from "../src/adapters/filesystem/scan-translator.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function committed(pattern: string): string[] {
  return execFileSync("git", ["ls-files", pattern], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter((path) => path.endsWith(".json"));
}

describe("a Repository built from committed scans", () => {
  it("every committed scan document reads", () => {
    const valid = [
      ...committed("schema/examples"),
      ...committed("fixtures"),
    ].filter(
      (path) =>
        !path.includes("/invalid/") &&
        (path.startsWith("schema/examples/") ||
          path.endsWith("expected-scan.json")),
    );

    expect(valid.length).toBeGreaterThan(0);

    const refused = valid.flatMap((path) => {
      try {
        readScanFile(JSON.parse(readFileSync(join(root, path), "utf8")));

        return [];
      } catch (error) {
        return [`${path}: ${(error as Error).message}`];
      }
    });

    expect(refused).toEqual([]);
  });

  it("reads an unchecked scan through the same entities", () => {
    const [path] = committed("fixtures").filter((one) =>
      one.endsWith("expected-scan.json"),
    );

    expect(path).toBeDefined();

    const repository = readUncheckedScanFile(
      JSON.parse(readFileSync(join(root, path as string), "utf8")),
    );

    expect(repository.files.length).toBeGreaterThan(0);
  });
});
