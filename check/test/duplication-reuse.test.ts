import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DUPLICATION_SETTINGS,
  type DuplicationSettings,
} from "../src/duplication/findings.js";
import { measureDuplication } from "../src/duplication/measure.js";
import { unitCachePath } from "../src/duplication/unit-cache.js";
import type { RecordedScan } from "../src/scan.js";
import { allParsers, measuredFixture, ROOT } from "./duplication-helpers.js";

function hashed(
  scans: RecordedScan[],
  fake: ReturnType<typeof measuredFixture>["fake"],
) {
  for (const scan of scans) {
    for (const file of scan.files) {
      file.hash = createHash("sha256")
        .update(fake.files.get(`${ROOT}/${file.path}`) ?? "")
        .digest("hex");
    }
  }

  return scans;
}

async function measure(
  setup: ReturnType<typeof measuredFixture>,
  settings: DuplicationSettings = DEFAULT_DUPLICATION_SETTINGS,
) {
  return measureDuplication(
    setup.fake.io,
    ROOT,
    hashed(setup.scans, setup.fake),
    settings,
    await allParsers(),
    true,
  );
}

function lastSummary(err: string): string {
  return (
    err
      .trim()
      .split("\n")
      .filter((line) => line.includes("files parsed"))
      .at(-1) ?? ""
  );
}

describe("reusing results for unchanged files", () => {
  it("parses every file the first time and reuses every file the second, with equal findings", async () => {
    const setup = measuredFixture("fixtures/duplication/sample");
    const first = await measure(setup);

    expect(lastSummary(setup.fake.err())).toBe(
      "duplication: 2 files parsed, 0 reused",
    );
    expect(first.length).toBe(2);
    expect(setup.fake.files.has(unitCachePath(ROOT))).toBe(true);

    const second = await measure(setup);

    expect(lastSummary(setup.fake.err())).toBe(
      "duplication: 0 files parsed, 2 reused",
    );
    expect(second).toEqual(first);
  });

  it("parses a changed file again and reuses the unchanged one", async () => {
    const setup = measuredFixture("fixtures/duplication/sample");

    await measure(setup);

    const path = `${ROOT}/app/pricing.py`;
    const text = setup.fake.files.get(path) as string;

    setup.fake.files.set(path, text.replace("levy", "duty"));

    const again = await measure(setup);

    expect(lastSummary(setup.fake.err())).toBe(
      "duplication: 1 files parsed, 1 reused",
    );
    expect(JSON.stringify(again)).toContain("sum_with_duty");
  });

  it("reparses everything when the settings that shape a unit change", async () => {
    const setup = measuredFixture("fixtures/duplication/sample");

    await measure(setup);
    await measure(setup, { ...DEFAULT_DUPLICATION_SETTINGS, min_lines: 5 });

    expect(lastSummary(setup.fake.err())).toBe(
      "duplication: 2 files parsed, 0 reused",
    );
  });

  it("ignores a corrupt cache with a line, parses everything and writes a good one", async () => {
    const setup = measuredFixture("fixtures/duplication/sample");

    setup.fake.files.set(unitCachePath(ROOT), "{not json");

    const findings = await measure(setup);

    expect(setup.fake.err()).toContain(
      "duplication: ignored the unreadable unit cache",
    );
    expect(lastSummary(setup.fake.err())).toBe(
      "duplication: 2 files parsed, 0 reused",
    );
    expect(findings.length).toBe(2);
    expect(() =>
      JSON.parse(setup.fake.files.get(unitCachePath(ROOT)) as string),
    ).not.toThrow();
  });

  it("drops entries for files no scan lists any more", async () => {
    const setup = measuredFixture("fixtures/duplication/sample");

    await measure(setup);

    const only = { ...setup, scans: setup.scans.slice(0, 1) };

    await measure(only);

    const cache = JSON.parse(
      setup.fake.files.get(unitCachePath(ROOT)) as string,
    );

    expect(Object.keys(cache.entries)).toHaveLength(1);
  });
});
