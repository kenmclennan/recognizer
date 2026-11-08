import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import { nodeIo } from "../src/cli.js";
import { manifestRoots, rustTestFiles } from "../src/rust-test-blocks.js";

type FileCase = {
  name: string;
  files: Record<string, string>;
  test_files: string[];
};

const CASES = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../../fixtures/rust-test-gate/file-cases.json"),
    "utf8",
  ),
) as FileCase[];

describe("rustTestFiles against the shared file cases", () => {
  it("reads a table with more than fifteen cases", () => {
    expect(CASES.length).toBeGreaterThan(22);
  });

  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, entry) => {
    const root = makeTempDir("recognizer-test-files-");

    for (const [path, text] of Object.entries(entry.files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }

    const found = rustTestFiles(nodeIo(), root, Object.keys(entry.files));

    expect([...found].sort()).toEqual([...entry.test_files].sort());
  });
});

const PACKAGE = '[package]\nname = "app"\nversion = "0.1.0"\n';

function listing(files: Record<string, string>): Set<string> {
  const root = makeTempDir("recognizer-test-files-");

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  return rustTestFiles(nodeIo(), root, Object.keys(files));
}

describe("manifest roots", () => {
  it("leaves the files of an unparseable manifest to name inference", () => {
    const found = listing({
      "Cargo.toml": "[package",
      "src/lib.rs": "#[cfg(test)]\nmod t;\n",
      "src/t.rs": "fn a() {}\n",
    });

    expect([...found]).toEqual(["src/t.rs"]);
  });

  it("resolves a covered package from its manifest and a bare directory by name", () => {
    const found = listing({
      "covered/Cargo.toml": `${PACKAGE}[lib]\npath = "other/mylib.rs"\n`,
      "covered/other/mylib.rs": "#[cfg(test)]\nmod t;\n",
      "covered/other/t.rs": "fn a() {}\n",
      "bare/lib.rs": "#[cfg(test)]\nmod t;\n",
      "bare/t.rs": "fn a() {}\n",
    });

    expect([...found].sort()).toEqual(["bare/t.rs", "covered/other/t.rs"]);
  });

  it("covers nothing for a virtual workspace manifest", () => {
    const files: Record<string, string> = {
      "Cargo.toml": "[workspace]\nmembers = []\n",
      "src/lib.rs": "",
    };
    const roots = manifestRoots(
      Object.keys(files),
      (path) => files[path] ?? null,
    );

    expect(roots.covered.size).toBe(0);
  });

  it("reads every target the scanner reads", () => {
    const files: Record<string, string> = {
      "p/Cargo.toml": `${PACKAGE}[[example]]\nname = "e"\npath = "demo/e.rs"\n[[test]]\nname = "t"\npath = "it/t.rs"\n`,
      "p/src/lib.rs": "",
      "p/src/main.rs": "",
      "p/build.rs": "",
      "p/demo/e.rs": "",
      "p/it/t.rs": "",
      "p/src/bin/a.rs": "",
      "p/src/bin/b/main.rs": "",
      "p/src/bin/b/other.rs": "",
      "p/benches/x.rs": "",
      "p/lib.rs": "",
    };
    const roots = manifestRoots(
      Object.keys(files),
      (path) => files[path] ?? null,
    );

    expect([...roots.roots].sort()).toEqual(
      [
        "p/src/lib.rs",
        "p/src/main.rs",
        "p/build.rs",
        "p/demo/e.rs",
        "p/it/t.rs",
        "p/src/bin/a.rs",
        "p/src/bin/b/main.rs",
        "p/benches/x.rs",
      ].sort(),
    );
  });

  it("declares no build script when build is false", () => {
    const files: Record<string, string> = {
      "Cargo.toml": PACKAGE.replace(
        "[package]\n",
        "[package]\nbuild = false\n",
      ),
      "build.rs": "",
    };
    const roots = manifestRoots(
      Object.keys(files),
      (path) => files[path] ?? null,
    );

    expect(roots.roots.has("build.rs")).toBe(false);
  });
});
