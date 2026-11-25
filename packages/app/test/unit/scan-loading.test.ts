import { describe, expect, it } from "vitest";
import { loadScans } from "../../src/scan-loading";

function scanDocument(
  ids: string[],
  overrides: Record<string, unknown> = {},
  language = "python",
) {
  return {
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
  };
}

describe("loadScans", () => {
  it("accepts a scan and lists its files", () => {
    const loaded = loadScans({
      scans: [
        {
          file: "scan.python.json",
          document: scanDocument(["a.py", "b.py"]),
        },
      ],
      notices: [],
    });

    expect(loaded.modules).toEqual(["a.py", "b.py"]);
    expect(loaded.scans.map((scan) => scan.file)).toEqual(["scan.python.json"]);
    expect(loaded.notices).toEqual([]);
    expect(loaded.blocking).toBeNull();
  });

  it("unions disjoint scans and keeps a repeated id once", () => {
    const loaded = loadScans({
      scans: [
        {
          file: "scan.python.json",
          document: scanDocument(["a.py", "shared"]),
        },
        {
          file: "scan.typescript.json",
          document: scanDocument(["shared", "b.ts"], {}, "typescript"),
        },
      ],
      notices: [],
    });

    expect(loaded.modules).toEqual(["a.py", "shared", "b.ts"]);
    expect(loaded.scans).toHaveLength(2);
  });

  it("carries the notices the service names", () => {
    const loaded = loadScans({
      scans: [{ file: "scan.python.json", document: scanDocument(["a.py"]) }],
      notices: ["scan.go.json is not valid JSON: nope"],
    });

    expect(loaded.modules).toEqual(["a.py"]);
    expect(loaded.notices).toEqual(["scan.go.json is not valid JSON: nope"]);
  });
});
