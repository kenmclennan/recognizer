import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isEntryPoint } from "../src/entry-points.js";
import { REPO } from "./helpers.js";

const CASES = JSON.parse(
  readFileSync(join(REPO, "fixtures/sensors/entry-points.json"), "utf8"),
) as { id: string; entry_points: string[]; expected: boolean }[];

describe("isEntryPoint against the shared sensor fixture", () => {
  it.each(CASES)("$id with $entry_points", (item) => {
    expect(isEntryPoint(item.id, new Set(), item.entry_points)).toBe(
      item.expected,
    );
  });
});
