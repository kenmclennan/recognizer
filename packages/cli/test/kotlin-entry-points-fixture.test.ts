import { readFileSync } from "node:fs";
import { join } from "node:path";
import { orphanWarnings } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";
import { validatedRepository as validateScan } from "./repository-from.js";

const ROOT = join(REPO, "fixtures/kotlin/entry-points");

describe("the Kotlin entry-points fixture", () => {
  it("leaves exactly the labelled orphans", () => {
    const scan = validateScan(
      JSON.parse(readFileSync(join(ROOT, "scan.json"), "utf8")),
    );
    const expected = JSON.parse(
      readFileSync(join(ROOT, "expected.json"), "utf8"),
    ) as { orphans: string[] };

    expect(
      orphanWarnings(scan, null, [], []).map((finding) => finding.id),
    ).toEqual(expected.orphans.map((id) => `orphan:${id}`));
  });
});

describe("the Kotlin di-orphans fixture", () => {
  it("leaves only the stray class beside an injected port", () => {
    const root = join(REPO, "fixtures/kotlin/di-orphans");
    const scan = validateScan(
      JSON.parse(readFileSync(join(root, "scan.json"), "utf8")),
    );
    const expected = JSON.parse(
      readFileSync(join(root, "expected.json"), "utf8"),
    ) as { orphans: string[] };

    expect(
      orphanWarnings(scan, null, [], []).map((finding) => finding.id),
    ).toEqual(expected.orphans.map((id) => `orphan:${id}`));
  });
});
