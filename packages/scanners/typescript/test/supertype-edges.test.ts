import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import { type ScanDocument, scan } from "../src/index.js";
import { PACKAGE, REPO, readJson, validate } from "./helpers.js";

const DIR = join(REPO, "fixtures/supertype-edges/typescript");
const EXPECTED = readJson(join(DIR, "expected-scan.json"));

const version = (
  JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as {
    version: string;
  }
).version;

function fixture(): ScanDocument {
  return scan(join(DIR, "sample"), null);
}

function edgesFrom(doc: ScanDocument, from: string, to: string) {
  return doc.edges.filter((edge) => edge.from === from && edge.to === to);
}

const CONTRACT = "src/dispatcher.ts";

describe("supertype edges", () => {
  it("matches the expected scan", () => {
    const doc = fixture();

    validate(doc);
    expect(doc).toEqual({
      ...EXPECTED,
      scanner: { ...EXPECTED.scanner, version },
    });
  });

  it("a supertype only reference makes only the supertype edge", () => {
    const doc = fixture();
    const edges = edgesFrom(doc, "src/default-dispatcher.ts", CONTRACT);

    expect(edges.some((edge) => edge.kind === "implements")).toBe(true);
    expect(edges.map((edge) => edge.kind)).toEqual(["implements"]);
  });

  it("a supertype and a field keep both edges", () => {
    const doc = fixture();
    const kinds = edgesFrom(doc, "src/logging-dispatcher.ts", CONTRACT)
      .map((edge) => edge.kind)
      .sort();

    expect(kinds).toEqual(["depends", "implements"]);
  });

  it("a subclass makes only an inherits edge", () => {
    const doc = fixture();
    const edges = edgesFrom(doc, "src/sub.ts", "src/base.ts");

    expect(edges.some((edge) => edge.kind === "inherits")).toBe(true);
    expect(edges.map((edge) => edge.kind)).toEqual(["inherits"]);
  });

  it("an unused import keeps its depends edge", () => {
    const doc = fixture();
    const edges = edgesFrom(doc, "src/unused.ts", CONTRACT);

    expect(edges.map((edge) => edge.kind)).toEqual(["depends"]);
  });

  it("the set of file pairs is unchanged by dropping supertype depends", () => {
    const doc = fixture();
    const supertypes = doc.edges.filter(
      (edge) => edge.kind === "implements" || edge.kind === "inherits",
    );

    expect(supertypes.length).toBeGreaterThanOrEqual(2);

    const pairs = new Set(doc.edges.map((edge) => `${edge.from}\0${edge.to}`));
    const restored = new Set(pairs);

    for (const edge of supertypes) {
      restored.add(`${edge.from}\0${edge.to}`);
    }

    expect(pairs).toEqual(restored);

    const dir = makeTempDir("recognizer-ts-supertype-");

    writeFileSync(join(dir, "package.json"), '{"name":"t","private":true}');
    writeFileSync(join(dir, "a.ts"), "export interface A {}\n");
    writeFileSync(
      join(dir, "b.ts"),
      'import type { A } from "./a";\nexport class B implements A {}\n',
    );

    const kept = scan(dir, null).edges.map(
      (edge) => `${edge.from}\0${edge.to}`,
    );

    expect(new Set(kept)).toEqual(new Set([`b.ts\0a.ts`]));
  });
});
