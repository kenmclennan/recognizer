import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  KEPT_BY_HAND,
  resolveScans,
  SCAN_TARGETS,
} from "./regenerate-targets.mjs";
import { makeTempDir, removeTempDirs } from "./temp-dirs.mjs";

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

afterAll(removeTempDirs);

function git(directory, ...args) {
  execFileSync("git", args, { cwd: directory, stdio: "ignore" });
}

function write(directory, path, name) {
  mkdirSync(join(directory, dirname(path)), { recursive: true });
  writeFileSync(join(directory, path), JSON.stringify({ scanner: { name } }));
}

describe("regenerate targets", () => {
  it("lists every committed scanner-written scan and keeps the hand-written ones out", () => {
    const resolved = resolveScans(REPOSITORY);

    expect(resolved.unlisted).toEqual([]);
    expect(resolved.targets.length).toBe(20);
    expect(resolved.keptByHand.length).toBe(3);
    expect([...resolved.targets].sort()).toEqual(
      SCAN_TARGETS.map((target) => target.output).sort(),
    );
    expect([...resolved.keptByHand].sort()).toEqual([...KEPT_BY_HAND].sort());
  });

  it("has an existing root folder and output file for every target", () => {
    expect(SCAN_TARGETS.length).toBeGreaterThan(0);

    for (const target of SCAN_TARGETS) {
      expect(existsSync(join(REPOSITORY, target.root)), target.root).toBe(true);
      expect(existsSync(join(REPOSITORY, target.output)), target.output).toBe(
        true,
      );
    }
  });

  it("reports an unlisted scan by path and resolves the other two", () => {
    const directory = makeTempDir("recognizer-regenerate-targets-");

    git(directory, "init", "-q");
    write(directory, "fixtures/a/expected-scan.json", "recognizer-scan-python");
    write(directory, "fixtures/b/scan.json", "hand-written");
    write(directory, "fixtures/c/scan.json", "recognizer-scan-rust");
    git(directory, "add", "fixtures");

    const resolved = resolveScans(
      directory,
      [{ output: "fixtures/a/expected-scan.json" }],
      ["fixtures/b/scan.json"],
    );

    expect(resolved.unlisted).toEqual(["fixtures/c/scan.json"]);
    expect(resolved.targets).toEqual(["fixtures/a/expected-scan.json"]);
    expect(resolved.keptByHand).toEqual(["fixtures/b/scan.json"]);
  });
});
