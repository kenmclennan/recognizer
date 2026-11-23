import { readFileSync } from "node:fs";
import type { Repository } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { readRepository } from "../src/adapters/filesystem/scan-translator.js";
import type { InputError } from "../src/errors.js";
import { SCAN_SCHEMA_VERSION, validateAcceptedScan } from "../src/scan.js";

const root = new URL("../../../", import.meta.url);

function read(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, root), "utf8"));
}

function messagesOf(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    return (error as InputError).messages;
  }

  return [];
}

function documentOf(paths: string[], edges: [string, string][] = []) {
  return {
    schema_version: SCAN_SCHEMA_VERSION,
    scanner: { name: "t", version: "0" },
    commit: null,
    modified: false,
    files: [],
    selection: {
      extensions: [],
      skip_directory_names: [],
      skip_directory_prefixes: [],
      skip_directory_suffixes: [],
      skip_directories_containing: [],
      skip_file_globs: [],
    },
    modules: paths.map((id) => ({
      id,
      language: "python",
      kind: "module",
      members: [],
    })),
    edges: edges.map(([from, to], index) => ({
      from,
      to,
      kind: "depends",
      line: index + 1,
    })),
    foreign: [],
  };
}

const abstractness = (language: string) =>
  read(`fixtures/abstractness/${language}/expected-scan.json`);

describe("readRepository", () => {
  it("translates one document into one file per module", () => {
    const check = readRepository([
      { language: "python", document: read("fixtures/check/scan.json") },
    ]);

    expect(check.files).toHaveLength(9);
    expect(check.dependencies).toHaveLength(12);
    expect(check.dependencies.filter((one) => one.toLibrary)).toHaveLength(2);
    expect(check.libraries).toHaveLength(2);
    expect(check.folders).toHaveLength(7);
    expect(check.files.every((file) => file.language === "python")).toBe(true);
    expect(check.files.every((file) => file.hash !== null)).toBe(true);

    const python = readRepository([
      { language: "python", document: abstractness("python") },
    ]);

    expect(python.files).toHaveLength(3);
    expect(python.dependencies).toHaveLength(4);
    expect(python.libraries).toHaveLength(3);
    expect(python.files.flatMap((file) => file.members)).toHaveLength(9);
    expect(python.calls).toHaveLength(1);
    expect(python.folders).toHaveLength(1);

    const typescript = readRepository([
      { language: "typescript", document: abstractness("typescript") },
    ]);

    expect(typescript.files).toHaveLength(3);
    expect(typescript.files.flatMap((file) => file.members)).toHaveLength(18);
    expect(typescript.dependencies).toHaveLength(0);
    expect(typescript.folders).toHaveLength(1);
    expect(typescript.files.every((file) => file.hash !== null)).toBe(true);
    expect(typescript.extractions[0]?.files).toHaveLength(4);
  });

  it("keeps the languages apart in one repository", () => {
    const both: Repository = readRepository([
      { language: "python", document: abstractness("python") },
      { language: "typescript", document: abstractness("typescript") },
    ]);
    const languageOf = new Map(
      both.files.map((file) => [file.path, file.language]),
    );

    expect(both.files).toHaveLength(6);
    expect(both.dependencies).toHaveLength(4);

    for (const dependency of both.dependencies) {
      expect(dependency.language).toBe(languageOf.get(dependency.from));

      if (!dependency.toLibrary) {
        expect(languageOf.get(dependency.to)).toBe(dependency.language);
      }
    }
  });

  it("derives folders from paths", () => {
    const repository = readRepository([
      {
        language: "python",
        document: documentOf(["a/b/c.py", "a/d.py", "e.py"]),
      },
    ]);
    const byPath = new Map(
      repository.folders.map((folder) => [folder.path, folder]),
    );

    expect(repository.folders.some((folder) => folder.path === "")).toBe(false);
    expect(repository.folders).toHaveLength(2);
    expect(byPath.get("a")?.parent).toBeNull();
    expect(byPath.get("a/b")?.parent).toBe("a");
    expect(
      repository.files.find((file) => file.path === "a/b/c.py")?.folder,
    ).toBe("a/b");
    expect(
      repository.files.find((file) => file.path === "e.py")?.folder,
    ).toBeNull();
  });

  it("a dependency to an id in no document stays", () => {
    const repository = readRepository([
      {
        language: "python",
        document: documentOf(["a.py"], [["a.py", "nowhere.py"]]),
      },
    ]);

    expect(repository.dependencies).toHaveLength(1);
    expect(repository.dependencies[0]).toMatchObject({
      from: "a.py",
      to: "nowhere.py",
      toLibrary: false,
    });
  });

  it("refuses what the CLI refuses", () => {
    for (const name of ["backslash-id", "call-with-extra-key"]) {
      const document = read(`schema/examples/invalid/${name}.json`);
      const expected = messagesOf(() => validateAcceptedScan(document));

      expect(expected.length).toBeGreaterThan(0);
      expect(
        messagesOf(() => readRepository([{ language: "python", document }])),
      ).toEqual(expected);
    }

    const newer = {
      ...documentOf(["a.py"]),
      schema_version: SCAN_SCHEMA_VERSION + 1,
    };

    expect(
      messagesOf(() =>
        readRepository([{ language: "python", document: newer }]),
      ),
    ).toEqual([
      `scan has schema_version ${SCAN_SCHEMA_VERSION + 1}, recognizer accepts ${SCAN_SCHEMA_VERSION}`,
    ]);
  });
});
