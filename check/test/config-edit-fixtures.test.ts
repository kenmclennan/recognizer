import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config-parse.js";
import { REPO } from "./helpers.js";

const read = (name: string) =>
  readFileSync(join(REPO, "fixtures/config-edit", name), "utf8");

describe("the config-edit fixtures", () => {
  for (const shape of [
    "describer",
    "third-party",
    "empty-flow",
    "four-space",
  ]) {
    it(`${shape}: the added text parses with duplication registered`, () => {
      const before = parseConfig(read(`${shape}.yaml`));
      const after = parseConfig(read(`${shape}.added.yaml`));

      expect(after.sensors?.duplication?.command).toContain(
        '{"threshold":0.82,"min_lines":4,"pair_min_lines":6,"min_nodes":20}',
      );
      expect(Object.keys(after.sensors ?? {})).toEqual([
        ...Object.keys(before.sensors ?? {}),
        "duplication",
      ]);
    });
  }
});
