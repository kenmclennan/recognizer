import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { check } from "./regenerate-check.mjs";
import { makeTempDir, removeTempDirs } from "./temp-dirs.mjs";

afterAll(removeTempDirs);

function repository() {
  const directory = makeTempDir("recognizer-regenerate-check-");

  for (const args of [
    ["init", "-q"],
    ["config", "user.email", "a@b.c"],
    ["config", "user.name", "a"],
  ]) {
    execFileSync("git", args, { cwd: directory });
  }

  writeFileSync(join(directory, "tracked.json"), "{}\n");
  execFileSync("git", ["add", "tracked.json"], { cwd: directory });
  execFileSync("git", ["commit", "-q", "-m", "first"], { cwd: directory });

  return directory;
}

describe("regenerate-check", () => {
  it("passes on a clean tree", () => {
    const directory = repository();

    expect(check(directory).code).toBe(0);
  });

  it("fails on a modified tracked file and names it", () => {
    const directory = repository();

    writeFileSync(join(directory, "tracked.json"), '{"a":1}\n');

    const result = check(directory);

    expect(result.output).toContain("tracked.json");
    expect(result.code).toBe(1);
  });

  it("fails on an untracked file and names it", () => {
    const directory = repository();

    writeFileSync(join(directory, "new.json"), "{}\n");

    const result = check(directory);

    expect(result.output).toContain("new.json");
    expect(result.code).toBe(1);
  });
});
