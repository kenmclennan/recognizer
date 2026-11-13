import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { capture } from "./helpers.js";
import { realTools } from "./plugin-tools.js";

describe("recognizer plugin check against the real tools", () => {
  it.each(realTools())("passes $name", ({ path }) => {
    const captured = capture();

    expect(run(["plugin", "check", path], captured.io)).toBe(0);
    expect(captured.out()).not.toMatch(/^fail/m);
  });
});
