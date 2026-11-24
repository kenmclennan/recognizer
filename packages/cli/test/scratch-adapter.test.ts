import { existsSync, mkdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { ScratchAdapter } from "../src/adapters/system/scratch-adapter.js";

describe("ScratchAdapter", () => {
  it("creates a recognizer-at folder and removes it", () => {
    const root = makeTempDir("recognizer-scratch-");
    const scratch = new ScratchAdapter(root);
    const folder = scratch.create() as string;

    expect(folder.startsWith(join(root, `recognizer-at-${process.pid}-`))).toBe(
      true,
    );
    expect(existsSync(folder)).toBe(true);

    scratch.remove(folder);

    expect(existsSync(folder)).toBe(false);
  });

  it("sweepStale removes only old recognizer-at folders", () => {
    const root = makeTempDir("recognizer-scratch-sweep-");
    const scratch = new ScratchAdapter(root);
    const old = new Date(Date.now() - 2 * 3_600_000);
    const staleScratch = join(root, "recognizer-at-1-1-1");
    const staleOther = join(root, "something-else");
    const fresh = scratch.create() as string;

    mkdirSync(staleScratch);
    mkdirSync(staleOther);
    utimesSync(staleScratch, old, old);
    utimesSync(staleOther, old, old);

    for (const path of [staleScratch, staleOther, fresh]) {
      expect(existsSync(path)).toBe(true);
    }

    scratch.sweepStale(3_600_000);

    expect(existsSync(staleScratch)).toBe(false);
    expect(existsSync(staleOther)).toBe(true);
    expect(existsSync(fresh)).toBe(true);
  });
});
