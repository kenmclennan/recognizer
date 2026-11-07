import { describe, expect, it } from "vitest";
import { validateScan } from "../src/scan.js";
import { orphanFindings } from "../src/structure-warnings.js";
import {
  libraryApiHint,
  testImportersOf,
  testOnlySummary,
} from "../src/test-importers.js";

type Records = { from: string; to: string; names?: string[] }[];

function scanOf(
  modules: string[],
  edges: [string, string][] = [],
  testImports?: Records,
  entryPoints: string[] = [],
) {
  return validateScan({
    schema_version: 7,
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
    modules: modules.map((id) => ({
      id,
      language: "python",
      kind: "module",
      members: [],
      ...(entryPoints.includes(id) ? { entry_point: true } : {}),
    })),
    edges: edges.map(([from, to], index) => ({
      from,
      to,
      kind: "depends",
      line: index + 1,
    })),
    foreign: [],
    ...(testImports === undefined ? {} : { test_imports: testImports }),
  });
}

function files(count: number, to = "a/lonely.py"): Records {
  return Array.from({ length: count }, (_, at) => ({
    from: `t/test_${String.fromCharCode(97 + at)}.py`,
    to,
  }));
}

const orphans = (scan: ReturnType<typeof scanOf>) =>
  orphanFindings(scan, null, []);

const TODAY = {
  summary: "a/lonely.py is imported by no module and is not an entry point",
  fix_pattern: "remove-or-wire-orphan",
  evidence: { modules: ["a/lonely.py"] },
};

describe("orphan test importers", () => {
  it("keeps today's finding when the key is absent or empty", () => {
    for (const scan of [
      scanOf(["a/lonely.py"]),
      scanOf(["a/lonely.py"], [], []),
    ]) {
      expect(orphans(scan)).toEqual([
        {
          id: "orphan:a/lonely.py",
          kind: "orphan",
          severity: "warning",
          principle: "every-module-is-reachable",
          ...TODAY,
        },
      ]);
    }
  });

  it("keeps today's finding when no record names the orphan", () => {
    const [finding] = orphans(
      scanOf(["a/lonely.py", "a/x.py"], [], files(2, "a/x.py")),
    );

    expect(finding).toMatchObject(TODAY);
  });

  it("says a module only tests import is imported only by them", () => {
    const [finding] = orphans(scanOf(["a/lonely.py"], [], files(2)));

    expect(finding).toEqual({
      id: "orphan:a/lonely.py",
      kind: "orphan",
      severity: "warning",
      principle: "every-module-is-reachable",
      summary:
        "a/lonely.py is imported only by 2 test files: t/test_a.py, t/test_b.py; it is not an entry point, so if it only supports tests move it next to them rather than deleting it",
      fix_pattern: "move-orphan-to-tests",
      evidence: {
        modules: ["a/lonely.py"],
        test_importers: [
          { file: "t/test_a.py", names: [] },
          { file: "t/test_b.py", names: [] },
        ],
      },
    });
  });

  it("names the first three files and counts the rest, keeping all in the evidence", () => {
    const [finding] = orphans(scanOf(["a/lonely.py"], [], files(5)));

    expect(finding?.summary).toContain(
      "imported only by 5 test files: t/test_a.py, t/test_b.py, t/test_c.py and 2 more;",
    );
    expect(finding?.evidence.test_importers).toHaveLength(5);
  });

  it("words one, three and four test files at the boundary", () => {
    const summaries = [1, 3, 4].map(
      (count) =>
        orphans(scanOf(["a/lonely.py"], [], files(count)))[0]?.summary ?? "",
    );

    expect(summaries[0]).toContain(
      "imported only by 1 test file: t/test_a.py;",
    );
    expect(summaries[1]).toContain(
      "only by 3 test files: t/test_a.py, t/test_b.py, t/test_c.py;",
    );
    expect(summaries[1]).not.toContain("more");
    expect(summaries[2]).toContain("t/test_c.py and 1 more;");
  });

  it("changes only the orphan tests import in a mixed scan", () => {
    const scan = scanOf(
      ["a/tested.py", "a/none.py", "a/used.py", "a/user.py"],
      [["a/user.py", "a/used.py"]],
      [
        { from: "t/test_1.py", to: "a/tested.py" },
        { from: "t/test_2.py", to: "a/used.py" },
      ],
    );
    const found = orphans(scan);

    expect(found.map((finding) => [finding.id, finding.fix_pattern])).toEqual([
      ["orphan:a/none.py", "remove-or-wire-orphan"],
      ["orphan:a/tested.py", "move-orphan-to-tests"],
      ["orphan:a/user.py", "remove-or-wire-orphan"],
    ]);
  });

  it("gives the names a record carries and an empty list for none", () => {
    const [finding] = orphans(
      scanOf(
        ["a/lonely.py"],
        [],
        [
          { from: "t/test_a.py", to: "a/lonely.py", names: ["Two", "One"] },
          { from: "t/test_b.py", to: "a/lonely.py" },
        ],
      ),
    );

    expect(finding?.evidence.test_importers).toEqual([
      { file: "t/test_a.py", names: ["One", "Two"] },
      { file: "t/test_b.py", names: [] },
    ]);
  });

  it("does not duplicate a file named by two records", () => {
    const importers = testImportersOf(
      scanOf(
        ["a/lonely.py"],
        [],
        [
          { from: "t/test_a.py", to: "a/lonely.py", names: ["A"] },
          { from: "t/test_a.py", to: "a/lonely.py", names: ["B"] },
        ],
      ),
    ).get("a/lonely.py");

    expect(importers).toEqual([{ file: "t/test_a.py", names: ["A", "B"] }]);
  });

  it("gives the same result however the records are ordered", () => {
    const records = files(5);
    const forward = orphans(scanOf(["a/lonely.py"], [], records));
    const shuffled = orphans(
      scanOf(["a/lonely.py"], [], [...records].reverse()),
    );

    expect(shuffled).toEqual(forward);
  });

  it("does not make an imported module an orphan or lift an entry point exemption", () => {
    const imported = orphans(
      scanOf(
        ["a/m.py", "a/n.py"],
        [["a/n.py", "a/m.py"]],
        [{ from: "t/test_a.py", to: "a/m.py" }],
      ),
    );
    const entry = orphans(
      scanOf(
        ["a/run.py"],
        [],
        [{ from: "t/test_a.py", to: "a/run.py" }],
        ["a/run.py"],
      ),
    );

    expect(imported.map((finding) => finding.id)).toEqual(["orphan:a/n.py"]);
    expect(entry).toEqual([]);
  });

  it("builds the summary without the evidence", () => {
    expect(testOnlySummary("a/m.py", [{ file: "t/x.py", names: [] }])).toMatch(
      /^a\/m\.py is imported only by 1 test file: t\/x\.py;/,
    );
  });

  it("ends the test-only summary of a Kotlin or C# id with the library hint", () => {
    for (const id of ["a/M.kt", "a/M.cs"]) {
      expect(testOnlySummary(id, [{ file: "t/x.kt", names: [] }])).toMatch(
        /move it next to them rather than deleting it; a library can list its public API in warnings\.orphan\.entry_points$/,
      );
    }
  });

  it("keeps the test-only summary of other ids unchanged", () => {
    for (const id of ["a/m.py", "a/m.ts", "a/m.rs"]) {
      expect(testOnlySummary(id, [{ file: "t/x", names: [] }])).toMatch(
        /rather than deleting it$/,
      );
    }
  });

  it("returns the hint for .kt and .cs and null for the rest", () => {
    expect(libraryApiHint("a/M.kt")).toBe(
      "; a library can list its public API in warnings.orphan.entry_points",
    );
    expect(libraryApiHint("a/M.cs")).toBe(libraryApiHint("a/M.kt"));

    for (const id of ["a/m.py", "a/m.ts", "a/m.rs", "a/m.kts"]) {
      expect(libraryApiHint(id)).toBeNull();
    }
  });
});
