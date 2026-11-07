import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateScan } from "../src/scan.js";
import { orphanFindings } from "../src/structure-warnings.js";
import { REPO } from "./helpers.js";

const ROOT = join(REPO, "fixtures/kotlin/entry-points");

describe("the Kotlin entry-points fixture", () => {
  it("leaves exactly the labelled orphans", () => {
    const scan = validateScan(
      JSON.parse(readFileSync(join(ROOT, "scan.json"), "utf8")),
    );
    const expected = JSON.parse(
      readFileSync(join(ROOT, "expected.json"), "utf8"),
    ) as { orphans: string[] };

    expect(orphanFindings(scan, null, []).map((finding) => finding.id)).toEqual(
      expected.orphans.map((id) => `orphan:${id}`),
    );
  });
});
