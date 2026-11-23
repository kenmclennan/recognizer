import { describe, expect, it } from "vitest";
import {
  compareUtf8,
  currentTestsHash,
  freshnessFor,
  indexOfBytes,
  inFileTestHashes,
  latin1,
  Repository,
  rustTestFiles,
  type TestsHashPorts,
} from "../../src/index.js";
import { createFakes } from "../fakes/container.js";
import { ROOT } from "./analysis-world.js";

function world() {
  const fakes = createFakes();
  const ports: TestsHashPorts = {
    source: fakes.source,
    digest: fakes.digest,
    toml: fakes.toml,
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

  it("skips an unreadable file and hashes the rest", () => {
    const { fakes, ports } = world();
    const item = (name: string) => `#[test]\nfn ${name}() {}\n`;

    fakes.source.files.set(`${ROOT}/src/a.rs`, item("a"));
    fakes.source.files.set(`${ROOT}/src/b.rs`, item("b"));

    fakes.source.listed = ["src/a.rs", "src/b.rs", "src/c.rs"];

    const withUnreadable = currentTestsHash(ports, ROOT, Repository.empty);

    fakes.source.listed = ["src/a.rs", "src/b.rs"];

    expect(withUnreadable).not.toBeNull();
    expect(withUnreadable).toBe(
      currentTestsHash(ports, ROOT, Repository.empty),
    );
    expect(
      [
        ...inFileTestHashes(ports, ROOT, [
          "src/a.rs",
          "src/b.rs",
          "src/c.rs",
        ]).keys(),
      ].sort(),
    ).toEqual(["src/a.rs#0", "src/b.rs#0"]);
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

  it("leaves the files of an unparseable manifest to name inference", () => {
    const { fakes, ports } = world();

    fakes.source.files.set(`${ROOT}/Cargo.toml`, "[package");
    fakes.source.files.set(`${ROOT}/src/lib.rs`, "#[cfg(test)]\nmod t;\n");
    fakes.source.files.set(`${ROOT}/src/t.rs`, "fn a() {}\n");

    expect([
      ...rustTestFiles(ports, ROOT, ["Cargo.toml", "src/lib.rs", "src/t.rs"]),
    ]).toEqual(["src/t.rs"]);
  });
});

describe("byte helpers", () => {
  it("finds a closer at the last byte of the data and none past the end", () => {
    const data = new Uint8Array([0x61, 0x22, 0x23, 0x23]);

    expect(indexOfBytes(data, [0x22, 0x23, 0x23], 0)).toBe(1);
    expect(indexOfBytes(data, [0x22, 0x23, 0x23], 2)).toBe(-1);
    expect(indexOfBytes(data, [0x23], 3)).toBe(3);
    expect(indexOfBytes(data, [0x23], 4)).toBe(-1);
  });

  it("decodes latin1 byte for byte", () => {
    expect(latin1(new Uint8Array([0x00, 0x80, 0xff]))).toBe("\u0000\u0080ÿ");
  });

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
