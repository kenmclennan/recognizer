import { createHash } from "node:crypto";
import {
  DEFAULT_DUPLICATION_SETTINGS,
  type DuplicationSettings,
  measureDuplication,
  Repository,
  readUnitCache,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { unitCachePath } from "../src/adapters/filesystem/findings-adapter.js";
import { analysisPortsOf, sayOf } from "./analysis-ports.js";
import {
  allParsers,
  GRAMMAR_RULES,
  measuredFixture,
  ROOT,
} from "./duplication-helpers.js";

function hashed(
  repository: Repository,
  fake: ReturnType<typeof measuredFixture>["fake"],
) {
  for (const extraction of repository.extractions) {
    for (const file of extraction.files) {
      (file as { hash: string }).hash = createHash("sha256")
        .update(fake.files.get(`${ROOT}/${file.path}`) ?? "")
        .digest("hex");
    }
  }

  return repository;
}

async function measure(
  setup: ReturnType<typeof measuredFixture>,
  settings: DuplicationSettings = DEFAULT_DUPLICATION_SETTINGS,
) {
  return measureDuplication(
    analysisPortsOf(setup.fake.io),
    sayOf(setup.fake.io),
    ROOT,
    hashed(setup.scans, setup.fake),
    settings,
    await allParsers(),
    GRAMMAR_RULES,
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

  it("ignores a unit cache written by an earlier port version", async () => {
    const setup = measuredFixture("fixtures/duplication/sample");

    await measure(setup);

    const written = JSON.parse(
      setup.fake.files.get(unitCachePath(ROOT)) as string,
    ) as { port: string };

    expect(written.port).toBe("3");

    setup.fake.files.set(
      unitCachePath(ROOT),
      JSON.stringify({ ...written, port: "2" }),
    );

    expect(
      analysisPortsOf(setup.fake.io).findings.readUnitCache(ROOT).cache,
    ).toEqual({});

    await measure(setup);

    expect(lastSummary(setup.fake.err())).toBe(
      "duplication: 2 files parsed, 0 reused",
    );
  });

  it("a unit cache written at port 2 is ignored", async () => {
    const setup = measuredFixture("fixtures/duplication/sample");

    await measure(setup);

    const written = JSON.parse(
      setup.fake.files.get(unitCachePath(ROOT)) as string,
    ) as { port: string };

    expect(written.port).toBe("3");

    setup.fake.files.set(
      unitCachePath(ROOT),
      JSON.stringify({ ...written, port: "2" }),
    );

    expect(
      analysisPortsOf(setup.fake.io).findings.readUnitCache(ROOT).cache,
    ).toEqual({});

    await measure(setup);

    expect(lastSummary(setup.fake.err())).toBe(
      "duplication: 2 files parsed, 0 reused",
    );
  });

  it("drops entries for files no scan lists any more", async () => {
    const setup = measuredFixture("fixtures/duplication/sample");

    await measure(setup);

    const first = setup.scans.extractions[0]?.language;
    const only = {
      ...setup,
      scans: Repository.of({
        ...setup.scans,
        extractions: setup.scans.extractions.slice(0, 1),
        files: setup.scans.files.filter((file) => file.language === first),
      }),
    };

    await measure(only);

    const cache = JSON.parse(
      setup.fake.files.get(unitCachePath(ROOT)) as string,
    );

    expect(Object.keys(cache.entries)).toHaveLength(1);
  });
});
