import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../scripts/temp-dirs.mjs";
import { cacheFolderOf } from "../src/cache-ignore.js";
import { nodeIo } from "../src/cli.js";

function root(): string {
  return makeTempDir("recognizer-cache-ignore-");
}

describe("cacheFolderOf", () => {
  it("returns the cache folder for a path under it", () => {
    expect(cacheFolderOf("/r/.recognizer/cache/log/x.json")).toBe(
      "/r/.recognizer/cache",
    );
  });

  it("returns null for a path outside the cache", () => {
    expect(cacheFolderOf("/r/.recognizer/policy.yaml")).toBeNull();
    expect(cacheFolderOf("/r/cache/x")).toBeNull();
  });
});

describe("the real Io's cache writes", () => {
  it("writeFile leaves the cache gitignore", () => {
    const base = root();
    const target = join(base, ".recognizer/cache/findings/x.json");

    nodeIo().writeFile(target, "{}");

    expect(existsSync(target)).toBe(true);
    expect(
      readFileSync(join(base, ".recognizer/cache/.gitignore"), "utf8"),
    ).toBe("*\n");
  });

  it("createExclusive leaves the cache gitignore", () => {
    const base = root();
    const target = join(base, ".recognizer/cache/marker.json");

    expect(nodeIo().createExclusive(target, "{}")).toBe(true);
    expect(
      readFileSync(join(base, ".recognizer/cache/.gitignore"), "utf8"),
    ).toBe("*\n");
  });

  it("append leaves the cache gitignore", () => {
    const base = root();
    const folder = join(base, ".recognizer/cache");
    const target = join(folder, "progress.log");

    mkdirSync(folder, { recursive: true });
    nodeIo().append(target, "x\n");

    expect(existsSync(target)).toBe(true);
    expect(readFileSync(join(folder, ".gitignore"), "utf8")).toBe("*\n");
  });

  it("a write outside the cache creates no cache folder", () => {
    const base = root();

    nodeIo().writeFile(join(base, ".recognizer/policy.yaml"), "x");

    expect(existsSync(join(base, ".recognizer/policy.yaml"))).toBe(true);
    expect(existsSync(join(base, ".recognizer/cache"))).toBe(false);
  });

  it("an existing cache gitignore is left alone", () => {
    const base = root();
    const folder = join(base, ".recognizer/cache");

    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, ".gitignore"), "custom\n");
    nodeIo().writeFile(join(folder, "x.json"), "{}");

    expect(readFileSync(join(folder, ".gitignore"), "utf8")).toBe("custom\n");
  });

  it("git status shows nothing under the cache", () => {
    const base = root();

    expect(spawnSync("git", ["init", "-q"], { cwd: base }).status).toBe(0);

    nodeIo().writeFile(join(base, ".recognizer/cache/findings/x.json"), "{}");

    const status = spawnSync("git", ["status", "--porcelain", "-uall"], {
      cwd: base,
      encoding: "utf8",
    });

    expect(status.status).toBe(0);
    expect(status.stdout).not.toContain(".recognizer/cache");
  });
});
