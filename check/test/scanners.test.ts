import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCANNERS } from "../src/scanners.js";

describe("the scanner install hints", () => {
  it("point every scanner at the Homebrew install", () => {
    for (const spec of SCANNERS) {
      expect(spec.install).toBe("brew install kenmclennan/tap/recognizer");
    }
  });

  it("leave no cargo, pipx or uvx hint in the source", () => {
    const repo = fileURLToPath(new URL("../..", import.meta.url));
    const result = spawnSync(
      "grep",
      ["-rn", "-E", "cargo install|pipx|uvx", "check/src"],
      { cwd: repo, encoding: "utf8" },
    );

    expect(result.stdout).toBe("");
  });
});
