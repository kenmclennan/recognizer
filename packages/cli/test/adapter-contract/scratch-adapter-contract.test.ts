import { existsSync } from "node:fs";
import type { Scratch } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import { ScratchAdapter } from "../../src/adapters/system/scratch-adapter.js";
import { FakeScratch } from "../support/index.js";

function suite(
  title: string,
  make: () => { scratch: Scratch; present: (folder: string) => boolean },
): void {
  describe(title, () => {
    it("a scratch folder is created and then removed", () => {
      const { scratch, present } = make();
      const folder = scratch.create();

      expect(folder).not.toBeNull();
      expect(present(folder as string)).toBe(true);

      scratch.remove(folder as string);

      expect(present(folder as string)).toBe(false);
    });

    it("two scratch folders differ", () => {
      const { scratch } = make();
      const first = scratch.create();
      const second = scratch.create();

      expect(first).not.toBeNull();
      expect(second).not.toBe(first);
    });
  });
}

suite("Scratch contract (fake)", () => {
  const scratch = new FakeScratch();

  return { scratch, present: (folder) => scratch.folders.has(folder) };
});

suite("Scratch contract (real adapter)", () => ({
  scratch: new ScratchAdapter(makeTempDir("scratch-contract-")),
  present: (folder) => existsSync(folder),
}));
