import { describe, expect, it } from "vitest";
import { archiveEntries, verifyArchive } from "./build-toolchain.mjs";

const closure = ["node_modules/ajv", "node_modules/yaml"];
const wheelhouse = ["tree_sitter-0.26.0-cp313-cp313-macosx_11_0_arm64.whl"];

describe("archiveEntries", () => {
  it("names the vendored packages, the wheel, the notices and the licence", () => {
    expect(archiveEntries("1.2.3", closure, wheelhouse)).toEqual([
      "node_modules/recognizer/package.json",
      "node_modules/recognizer-scan-typescript/package.json",
      "node_modules/recognizer-describe-claude/package.json",
      "node_modules/ajv/package.json",
      "node_modules/yaml/package.json",
      "recognizer_scan_python-1.2.3-py3-none-any.whl",
      "recognizer_scan_kotlin-1.2.3-py3-none-any.whl",
      "wheelhouse/tree_sitter-0.26.0-cp313-cp313-macosx_11_0_arm64.whl",
      "recognizer-scan-rust",
      "THIRD-PARTY-NOTICES.md",
      "LICENSE",
    ]);
  });
});

describe("verifyArchive", () => {
  const full = `${archiveEntries("1.2.3", closure, wheelhouse).join("\n")}\n`;

  it("accepts a complete listing", () => {
    expect(() =>
      verifyArchive(full, "1.2.3", closure, wheelhouse),
    ).not.toThrow();
  });

  it("accepts a listing whose names carry a leading ./", () => {
    const listing = archiveEntries("1.2.3", closure, wheelhouse)
      .map((name) => `./${name}`)
      .join("\n");

    expect(() =>
      verifyArchive(listing, "1.2.3", closure, wheelhouse),
    ).not.toThrow();
  });

  it("fails when the wheel is missing", () => {
    const listing = full.replace(/recognizer_scan_python.*\n/, "");

    expect(() => verifyArchive(listing, "1.2.3", closure, wheelhouse)).toThrow(
      /recognizer_scan_python/,
    );
  });

  it.each([
    ["the Rust binary", "recognizer-scan-rust\n", /recognizer-scan-rust/],
    [
      "the Kotlin wheel",
      "recognizer_scan_kotlin-1.2.3-py3-none-any.whl\n",
      /recognizer_scan_kotlin/,
    ],
    [
      "a wheelhouse file",
      "wheelhouse/tree_sitter-0.26.0-cp313-cp313-macosx_11_0_arm64.whl\n",
      /wheelhouse\/tree_sitter/,
    ],
    [
      "the describer",
      "node_modules/recognizer-describe-claude/package.json\n",
      /recognizer-describe-claude/,
    ],
  ])("fails when %s is missing", (_, entry, pattern) => {
    expect(() =>
      verifyArchive(full.replace(entry, ""), "1.2.3", closure, wheelhouse),
    ).toThrow(pattern);
  });

  it("fails when the notices file is missing", () => {
    const listing = full.replace("THIRD-PARTY-NOTICES.md\n", "");

    expect(() => verifyArchive(listing, "1.2.3", closure, wheelhouse)).toThrow(
      /THIRD-PARTY-NOTICES\.md/,
    );
  });

  it("fails when a closure package is missing", () => {
    const listing = full.replace("node_modules/yaml/package.json\n", "");

    expect(() => verifyArchive(listing, "1.2.3", closure, wheelhouse)).toThrow(
      /node_modules\/yaml/,
    );
  });

  it("fails for a listing built for another version", () => {
    expect(() => verifyArchive(full, "1.2.4", closure, wheelhouse)).toThrow(
      /1\.2\.4/,
    );
  });
});
