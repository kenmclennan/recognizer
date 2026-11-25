import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readStructure } from "../src/structure-read.js";
import { REPO } from "./helpers.js";

function scanText(
  ids: string[],
  overrides: Record<string, unknown> = {},
  language = "python",
) {
  return JSON.stringify({
    schema_version: 7,
    scanner: { name: "recognizer-scan-python", version: "0" },
    commit: null,
    modified: null,
    files: [],
    selection: {
      extensions: [".py"],
      skip_directory_names: [],
      skip_directory_prefixes: [],
      skip_directory_suffixes: [],
      skip_directories_containing: [],
      skip_file_globs: [],
    },
    modules: ids.map((id) => ({
      id,
      language,
      kind: "module",
      members: [],
    })),
    edges: [],
    foreign: [],
    ...overrides,
  });
}

const filesOf = (read: ReturnType<typeof readStructure>) =>
  read.scans.map((scan) => scan.file);

describe("loadScans", () => {
  it("accepts a scan and lists its files", () => {
    const read = readStructure([
      { file: "scan.python.json", text: scanText(["a.py", "b.py"]) },
    ]);

    expect(filesOf(read)).toEqual(["scan.python.json"]);
    expect(read.notices).toEqual([]);
  });

  it("refuses an unknown schema_version with a notice and still loads the others", () => {
    const read = readStructure([
      { file: "scan.python.json", text: scanText(["a.py"]) },
      {
        file: "scan.typescript.json",
        text: scanText(["b.ts"], { schema_version: 9 }),
      },
    ]);

    expect(filesOf(read)).toEqual(["scan.python.json"]);
    expect(read.notices).toEqual([
      "scan.typescript.json has schema_version 9; this viewer reads 7",
    ]);
  });

  it("loads a current scan and refuses a broken one given together", () => {
    const read = readStructure([
      { file: "scan.python.json", text: scanText(["a.py"]) },
      {
        file: "scan.kotlin.json",
        text: scanText(["k.kt"], { schema_version: 6 }),
      },
    ]);

    expect(filesOf(read)).toEqual(["scan.python.json"]);
    expect(read.notices).toEqual([
      "scan.kotlin.json has schema_version 6; this viewer reads 7",
    ]);
  });

  it("refuses a version 2 scan, which the previous scanners wrote", () => {
    const read = readStructure([
      {
        file: "scan.python.json",
        text: scanText(["a.py"], { schema_version: 2 }),
      },
    ]);

    expect(read.scans).toEqual([]);
    expect(read.notices).toEqual([
      "scan.python.json has schema_version 2; this viewer reads 7",
    ]);
  });

  it("refuses invalid JSON", () => {
    const read = readStructure([{ file: "scan.python.json", text: "{nope" }]);

    expect(read.scans).toEqual([]);
    expect(read.notices).toHaveLength(1);
    expect(read.notices[0]).toContain("scan.python.json is not valid JSON");
  });

  it("refuses a document missing a list", () => {
    for (const missing of ["modules", "edges", "foreign"]) {
      const read = readStructure([
        {
          file: "scan.python.json",
          text: scanText(["a.py"], { [missing]: undefined }),
        },
      ]);

      expect(read.scans).toEqual([]);
      expect(read.notices[0]).toContain("lacks the files, edges and foreign");
    }
  });

  it("names exactly the two refused files among three", () => {
    const read = readStructure([
      { file: "scan.go.json", text: "garbage" },
      { file: "scan.python.json", text: scanText(["a.py"]) },
      {
        file: "scan.typescript.json",
        text: scanText(["b.ts"], { schema_version: 1 }),
      },
    ]);

    expect(filesOf(read)).toEqual(["scan.python.json"]);
    expect(read.notices).toHaveLength(2);
    expect(read.notices[0]).toContain("scan.go.json");
    expect(read.notices[1]).toContain("scan.typescript.json");
  });

  it("reads the repository's own committed scans when present", () => {
    const cache = join(REPO, ".recognizer/cache");

    if (!existsSync(cache)) {
      return;
    }

    const files = readdirSync(cache)
      .filter((name) => /^scan\..+\.json$/.test(name))
      .map((name) => ({
        file: name,
        text: readFileSync(join(cache, name), "utf8"),
      }));
    const read = readStructure(files);

    expect(read.scans.length + read.notices.length).toBe(files.length);
  });
});
