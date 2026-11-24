import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isEntryPoint } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";
import { BEHAVIOUR } from "./language-behaviour-fixture.js";

const CASES = JSON.parse(
  readFileSync(join(REPO, "fixtures/sensors/entry-points.json"), "utf8"),
) as { id: string; entry_points: string[]; expected: boolean }[];

describe("isEntryPoint against the shared sensor fixture", () => {
  it.each(CASES)("$id with $entry_points", (item) => {
    expect(isEntryPoint(item.id, [], item.entry_points, false, BEHAVIOUR)).toBe(
      item.expected,
    );
  });
});
