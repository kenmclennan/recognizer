import { describe, expect, it } from "vitest";
import { archiveEntries, verifyArchive } from "./build-toolchain.mjs";

describe("archiveEntries", () => {
  it("names exactly the five files of the toolchain", () => {
    expect(archiveEntries("1.2.3")).toEqual([
      "recognizer-1.2.3.tgz",
      "recognizer-scan-typescript-1.2.3.tgz",
      "recognizer_scan_python-1.2.3-py3-none-any.whl",
      "THIRD-PARTY-NOTICES.md",
      "LICENSE",
    ]);
  });
});

describe("verifyArchive", () => {
  const full = `${archiveEntries("1.2.3").join("\n")}\n`;

  it("accepts a complete listing", () => {
    expect(() => verifyArchive(full, "1.2.3")).not.toThrow();
  });

  it("accepts a listing whose names carry a leading ./", () => {
    const listing = archiveEntries("1.2.3")
      .map((name) => `./${name}`)
      .join("\n");

    expect(() => verifyArchive(listing, "1.2.3")).not.toThrow();
  });

  it("fails when the wheel is missing", () => {
    const listing = full.replace(/recognizer_scan_python.*\n/, "");

    expect(() => verifyArchive(listing, "1.2.3")).toThrow(
      /recognizer_scan_python/,
    );
  });

  it("fails when the notices file is missing", () => {
    const listing = full.replace("THIRD-PARTY-NOTICES.md\n", "");

    expect(() => verifyArchive(listing, "1.2.3")).toThrow(
      /THIRD-PARTY-NOTICES\.md/,
    );
  });

  it("fails for a listing built for another version", () => {
    expect(() => verifyArchive(full, "1.2.4")).toThrow(/1\.2\.4/);
  });
});
