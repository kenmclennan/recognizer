import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareUtf8,
  currentTestsHash,
  freshnessFor,
  Repository,
  type TestsHashPorts,
} from "../../src/index.js";
import { createFakes } from "../fakes/container.js";
import { ROOT } from "./analysis-world.js";

function world() {
  const fakes = createFakes();
  const ports: TestsHashPorts = {
    source: fakes.source,
    digest: fakes.digest,
    testReports: fakes.testReports,
  };

  return { fakes, ports };
}

function scannedAs(hashes: Record<string, string>): Repository {
  return {
    scannedHashes: () => new Map(Object.entries(hashes)),
  } as unknown as Repository;
}

describe("currentTestsHash", () => {
  it("returns null when the listing fails", () => {
    const { fakes, ports } = world();

    fakes.source.listed = null;

    expect(currentTestsHash(ports, ROOT, Repository.empty)).toBeNull();
    expect(fakes.source.calls).toEqual(["listFiles"]);
  });

  it("prefers the scan's own hash over re-hashing a file", () => {
    const { fakes, ports } = world();

    fakes.source.listed = ["tests/a.py", "tests/b.py"];
    fakes.source.hashes.set(`${ROOT}/tests/a.py`, "disk-a");
    fakes.source.hashes.set(`${ROOT}/tests/b.py`, "disk-b");

    const digest = currentTestsHash(
      ports,
      ROOT,
      scannedAs({ "tests/a.py": "scanned-a" }),
    );

    expect(digest).toBe(
      fakes.digest.sha256("tests/a.py\tscanned-a\ntests/b.py\tdisk-b\n"),
    );
    expect(fakes.source.calls).not.toContain("hashOf tests/a.py");
    expect(fakes.source.calls).toContain("hashOf tests/b.py");
  });

  it("sorts an astral path after a BMP one", () => {
    const { fakes, ports } = world();
    const bmp = "tests/\u{ffff}.py";
    const astral = "tests/\u{10000}.py";

    fakes.source.listed = [astral, bmp];
    fakes.source.hashes.set(`${ROOT}/${bmp}`, "h1");
    fakes.source.hashes.set(`${ROOT}/${astral}`, "h2");

    expect(currentTestsHash(ports, ROOT, Repository.empty)).toBe(
      fakes.digest.sha256(`${bmp}\th1\n${astral}\th2\n`),
    );
  });

  it("returns null when a scanner's answer fails", () => {
    const { fakes, ports } = world();

    fakes.source.listed = ["tests/a.py"];
    fakes.source.hashes.set(`${ROOT}/tests/a.py`, "h");

    expect(currentTestsHash(ports, ROOT, Repository.empty)).not.toBeNull();

    fakes.testReports.reported = null;

    expect(currentTestsHash(ports, ROOT, Repository.empty)).toBeNull();
  });

  it("combines a test report with the generic entries to the shared digest", () => {
    const { fakes, ports } = world();
    const expected = JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          "../../../../fixtures/sensors/tests-digest/expected.json",
        ),
        "utf8",
      ),
    ) as { digest: string; entries: Record<string, string> };
    const own = Object.entries(expected.entries).filter(([key]) =>
      key.includes("#"),
    );
    const generic = Object.entries(expected.entries).filter(
      ([key]) => !key.includes("#"),
    );

    fakes.testReports.reported = new Map(own);
    fakes.source.listed = [
      ...generic.map(([path]) => path),
      "src/lib.rs",
      "src/more.rs",
    ];

    for (const [path, hash] of generic) {
      fakes.source.hashes.set(`${ROOT}/${path}`, hash);
    }

    expect(currentTestsHash(ports, ROOT, Repository.empty)).toBe(
      expected.digest,
    );
  });
});

describe("byte helpers", () => {
  it("compares by UTF-8 bytes", () => {
    expect(compareUtf8("\u{ffff}", "\u{10000}")).toBeLessThan(0);
    expect(compareUtf8("a", "a")).toBe(0);
    expect(compareUtf8("ab", "a")).toBeGreaterThan(0);
  });
});

describe("freshnessFor", () => {
  it("judges freshness with one listing", () => {
    const { fakes, ports } = world();
    const judge = freshnessFor(ports, ROOT, Repository.empty);

    judge({ inputs: {} });

    expect(fakes.source.calls).toEqual([]);

    judge({ inputs: {}, tests: "t" });
    judge({ inputs: {}, tests: "t" });

    expect(
      fakes.source.calls.filter((call) => call === "listFiles"),
    ).toHaveLength(1);
  });
});
