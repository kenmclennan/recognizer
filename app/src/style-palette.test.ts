import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");

describe("the stylesheet palette", () => {
  it("has no prefers-color-scheme rule, so a light palette cannot return", () => {
    expect(css).not.toMatch(/prefers-color-scheme/);
  });

  it("declares the dark colour scheme on the root", () => {
    expect(css).toMatch(/:root\s*\{\s*color-scheme:\s*dark;/);
  });
});
