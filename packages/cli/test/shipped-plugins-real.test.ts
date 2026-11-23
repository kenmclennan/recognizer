import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shippedPlugins as listed } from "../scripts/build-shipped.mjs";
import { shippedPlugins } from "../src/adapters/plugins/shipped-plugins-adapter.js";
import { REPO } from "./helpers.js";

const UNITS = JSON.parse(
  readFileSync(join(REPO, "tools/packaging/units.json"), "utf8"),
);

describe("the shipped plugin lists", () => {
  it("units.json yields crap and mutation, claude and the five scanners", () => {
    const generated = JSON.parse(
      readFileSync(
        join(REPO, "packages/cli/dist/generated/shipped-plugins.json"),
        "utf8",
      ),
    );

    expect(listed(UNITS)).toEqual(generated);
    expect(generated.sensors).toEqual(["crap", "mutation"]);
    expect(generated.describers).toEqual(["claude"]);
    expect(generated.scanners).toEqual([
      "csharp",
      "kotlin",
      "python",
      "rust",
      "typescript",
    ]);
  });

  it("the adapter serves the same lists", () => {
    expect(shippedPlugins().sensors()).toEqual(["crap", "mutation"]);
    expect(shippedPlugins().describers()).toEqual(["claude"]);
    expect(shippedPlugins().scanners()).toHaveLength(5);
  });
});
