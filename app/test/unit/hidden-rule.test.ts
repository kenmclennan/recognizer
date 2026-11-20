import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcUrl = new URL("../../src/index.ts", import.meta.url).href;

const css = readFileSync(fileURLToPath(new URL("style.css", srcUrl)), "utf8");

describe("the hidden attribute in the stylesheet", () => {
  it("has one global rule that hides with !important so no class rule can outrank it", () => {
    expect(css).toMatch(/^\[hidden\] \{\s*display: none !important;\s*\}/m);
  });

  it("has no per-class hidden rule left for the next display rule to forget", () => {
    const perClass = css
      .split("\n")
      .filter(
        (line) => /\[hidden\]/.test(line) && !/^\[hidden\] \{/.test(line),
      );

    expect(perClass).toEqual([]);
  });
});
