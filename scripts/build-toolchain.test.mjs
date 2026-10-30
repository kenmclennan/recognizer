import { describe, expect, it } from "vitest";
import { archiveEntries, verifyArchive } from "./build-toolchain.mjs";

const closure = ["node_modules/ajv", "node_modules/yaml"];

describe("archiveEntries", () => {
  it("names the vendored packages, the wheel, the notices and the licence", () => {
    expect(archiveEntries("1.2.3", closure)).toEqual([
      "node_modules/recognizer/package.json",
      "node_modules/recognizer-scan-typescript/package.json",
      "node_modules/ajv/package.json",
      "node_modules/yaml/package.json",
      "recognizer_scan_python-1.2.3-py3-none-any.whl",
      "THIRD-PARTY-NOTICES.md",
      "LICENSE",
    ]);
  });
});

describe("verifyArchive", () => {
  const full = `${archiveEntries("1.2.3", closure).join("\n")}\n`;

  it("accepts a complete listing", () => {
    expect(() => verifyArchive(full, "1.2.3", closure)).not.toThrow();
  });

  it("accepts a listing whose names carry a leading ./", () => {
    const listing = archiveEntries("1.2.3", closure)
      .map((name) => `./${name}`)
      .join("\n");

    expect(() => verifyArchive(listing, "1.2.3", closure)).not.toThrow();
  });

  it("fails when the wheel is missing", () => {
    const listing = full.replace(/recognizer_scan_python.*\n/, "");

    expect(() => verifyArchive(listing, "1.2.3", closure)).toThrow(
      /recognizer_scan_python/,
    );
  });

  it("fails when the notices file is missing", () => {
    const listing = full.replace("THIRD-PARTY-NOTICES.md\n", "");

    expect(() => verifyArchive(listing, "1.2.3", closure)).toThrow(
      /THIRD-PARTY-NOTICES\.md/,
    );
  });

  it("fails when a closure package is missing", () => {
    const listing = full.replace("node_modules/yaml/package.json\n", "");

    expect(() => verifyArchive(listing, "1.2.3", closure)).toThrow(
      /node_modules\/yaml/,
    );
  });

  it("fails for a listing built for another version", () => {
    expect(() => verifyArchive(full, "1.2.4", closure)).toThrow(/1\.2\.4/);
  });
});
