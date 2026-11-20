import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GRAMMAR_NAMES } from "../src/duplication/grammars.js";
import { GRAMMAR_DIRECTORY } from "../src/duplication/parsers.js";

interface Provenance {
  grammars: Record<
    string,
    { source: string; revision: string; file: string; sha256: string }
  >;
}

const provenance = JSON.parse(
  readFileSync(join(GRAMMAR_DIRECTORY, "PROVENANCE.json"), "utf8"),
) as Provenance;

describe("the vendored grammar files", () => {
  it("record a source, a pinned revision and a checksum for every grammar", () => {
    expect(Object.keys(provenance.grammars).sort()).toEqual(
      [...GRAMMAR_NAMES].sort(),
    );

    for (const entry of Object.values(provenance.grammars)) {
      expect(entry.revision).toMatch(/^[0-9a-f]{40}$/);
      expect(entry.source).toMatch(/^https:\/\/github\.com\//);
    }
  });

  it("match their recorded checksums and leave no unrecorded wasm file", () => {
    for (const entry of Object.values(provenance.grammars)) {
      const digest = createHash("sha256")
        .update(readFileSync(join(GRAMMAR_DIRECTORY, entry.file)))
        .digest("hex");

      expect(digest, entry.file).toBe(entry.sha256);
    }

    expect(
      readdirSync(GRAMMAR_DIRECTORY)
        .filter((name) => name.endsWith(".wasm"))
        .sort(),
    ).toEqual(
      Object.values(provenance.grammars)
        .map((e) => e.file)
        .sort(),
    );
  });
});
