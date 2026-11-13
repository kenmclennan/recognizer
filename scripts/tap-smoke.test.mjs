import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fencedBlock, INSTALL_COMMANDS } from "./tap-smoke.mjs";

const README = readFileSync(
  fileURLToPath(new URL("../README.md", import.meta.url)),
  "utf8",
);

describe("the commands tap-smoke runs", () => {
  it("equal the first sh block of the README's Install section", () => {
    expect(fencedBlock(README, "Install")).toEqual(INSTALL_COMMANDS);
  });

  it("fails when a section or its block is absent", () => {
    expect(() => fencedBlock("# x\n\n## Install\n\ntext\n", "Install")).toThrow(
      /no sh block/,
    );
    expect(() => fencedBlock("# x\n", "Uninstall")).toThrow(
      /no Uninstall section/,
    );
  });
});
