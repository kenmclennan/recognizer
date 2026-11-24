import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ensureBuilt,
  missingBuilds,
  REQUIRED_BUILDS,
} from "./ensure-built.mjs";
import { makeTempDir } from "./temp-dirs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");

describe("missingBuilds", () => {
  it("names every required file that is absent", () => {
    expect(REQUIRED_BUILDS).toHaveLength(4);

    const present = new Set([
      join("/r", REQUIRED_BUILDS[0]),
      join("/r", REQUIRED_BUILDS[2]),
    ]);

    expect(missingBuilds("/r", (path) => present.has(path))).toEqual([
      REQUIRED_BUILDS[1],
      REQUIRED_BUILDS[3],
    ]);
  });

  it("returns nothing when every file exists", () => {
    expect(missingBuilds("/r", () => true)).toEqual([]);
  });
});

describe("ensureBuilt", () => {
  it("builds once and only when something is missing", async () => {
    let calls = 0;
    const build = () => {
      calls += 1;
    };

    const empty = makeTempDir("ensure-built-empty-");
    const missing = await ensureBuilt(empty, build);

    expect(calls).toBe(1);
    expect(missing).toEqual(REQUIRED_BUILDS);

    const full = makeTempDir("ensure-built-full-");

    for (const path of REQUIRED_BUILDS) {
      mkdirSync(dirname(join(full, path)), { recursive: true });
      writeFileSync(join(full, path), "");
    }

    await ensureBuilt(full, build);

    expect(calls).toBe(1);
  });

  it("passes a failing build's error through", async () => {
    const failure = new Error("pretest failed");

    await expect(
      ensureBuilt("/definitely/not/a/root", () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});

describe("REQUIRED_BUILDS", () => {
  it("lists only paths a CLI test reads", () => {
    const testDir = join(root, "packages/cli/test");
    const sources = readdirSync(testDir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(join(testDir, name), "utf8"));

    expect(REQUIRED_BUILDS).toHaveLength(4);

    for (const path of REQUIRED_BUILDS) {
      const tail = path.split("/").slice(-2).join("/");
      const pkg = path.split("/").slice(0, 3).join("/");
      const found = sources.some(
        (text) =>
          text.includes(path) || (text.includes(tail) && text.includes(pkg)),
      );

      expect(found, path).toBe(true);
    }
  });
});
