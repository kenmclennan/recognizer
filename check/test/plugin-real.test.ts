import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { run } from "../src/cli.js";
import { capture } from "./helpers.js";
import { realTools } from "./plugin-tools.js";

describe("recognizer plugin check against the real tools", () => {
  it.each(realTools())(
    "passes $name",
    async ({ name, path }) => {
      const captured = capture();

      expect(await run(["plugin", "check", path], captured.io)).toBe(0);
      expect(captured.out()).not.toMatch(/^fail/m);

      if (name === "recognizer-describe-claude") {
        expect(captured.out()).toMatch(/^warn {2}run-verb/m);
        expect(captured.out()).toMatch(/^warn {2}stop/m);
      }
    },
    scaledTimeout(120000),
  );
});
