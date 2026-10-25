import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scan } from "../src/index.js";
import {
  ajvValidate,
  FIXTURE,
  listFiles,
  PACKAGE,
  REPO,
  readJson,
  runBin,
  validate,
} from "./helpers.js";

const SAMPLE = join(FIXTURE, "sample");
const EXPECTED = readJson(join(FIXTURE, "expected-scan.json"));

describe("schema examples", () => {
  const valid = join(REPO, "schema/examples/valid");
  const invalid = join(REPO, "schema/examples/invalid");

  it.each(listFiles(valid))("validates valid example %s", (name) => {
    expect(
      ajvValidate(JSON.parse(readFileSync(join(valid, name), "utf8"))),
    ).toBe(true);
  });

  it.each(listFiles(invalid))("rejects invalid example %s", (name) => {
    expect(
      ajvValidate(JSON.parse(readFileSync(join(invalid, name), "utf8"))),
    ).toBe(false);
  });
});

describe("fixture", () => {
  const version = (
    JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as {
      version: string;
    }
  ).version;

  it("matches the expected scan and validates", () => {
    const doc = scan(SAMPLE, null);

    expect(doc.scanner.name).toBe("recognizer-scan-typescript");
    expect(doc.scanner.version).toBe(version);

    validate(doc);
    expect(doc).toEqual({
      ...EXPECTED,
      scanner: { ...EXPECTED.scanner, version },
    });
  });

  it("has the expected module and edge counts and exactly the fixture calls", () => {
    const doc = scan(SAMPLE, null);

    expect(doc.modules).toHaveLength(15);
    expect(doc.edges).toHaveLength(21);
    expect(doc.calls.map((c) => `${c.from} -> ${c.to} ${c.how}`)).toEqual([
      "api/src/base-store.ts::BaseStore.count -> api/src/base-store.ts::BaseStore.grow call",
      "api/src/base-store.ts::makeBase -> api/src/base-store.ts::BaseStore construct",
      "api/src/memory-store.ts::fresh -> api/src/base-store.ts::makeBase call",
      "api/src/place.ts::place -> api/src/types.ts::Store.save inferred",
      "api/src/types.ts::Store.save -> api/src/memory-store.ts::MemoryStore.save dispatch",
      "web/src/App.tsx::App -> api/src/memory-store.ts::MemoryStore construct",
    ]);
  });

  it("emits no package module and no unknown member kind", () => {
    const doc = scan(SAMPLE, null);
    const kinds = new Set(
      doc.modules.flatMap((m) => m.members.map((x) => x.kind)),
    );

    expect(doc.modules.every((m) => m.kind !== ("package" as string))).toBe(
      true,
    );
    expect(
      [...kinds].every((k) =>
        ["class", "function", "interface", "type", "constant"].includes(k),
      ),
    ).toBe(true);
  });
});

describe("cli", () => {
  it("prints the expected scan with --commit and writes identical bytes with --output", () => {
    const first = runBin(SAMPLE, "--commit", "abc1234");
    const second = runBin(SAMPLE, "--commit", "abc1234");

    expect(first.status).toBe(0);
    expect(first.stdout).toBe(second.stdout);

    const doc = JSON.parse(first.stdout);
    validate(doc);
    expect(doc).toEqual({
      ...EXPECTED,
      commit: "abc1234",
      scanner: doc.scanner,
    });

    const output = join(
      mkdtempSync(join(tmpdir(), "recognizer-ts-out-")),
      "scan.json",
    );
    const written = runBin(SAMPLE, "--commit", "abc1234", "--output", output);

    expect(written.status).toBe(0);
    expect(written.stdout).toBe("");
    expect(readFileSync(output, "utf8")).toBe(first.stdout);
  });

  it("exits 2 on a usage error", () => {
    const result = runBin(SAMPLE, "--bogus");

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
  });
});
