import { readFileSync } from "node:fs";
import { Repository, ScanSelection } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { parseNameStatus } from "../src/adapters/git/name-status-parse.js";
import {
  changeMarks,
  classifyChanges,
  classifyOpened,
  type FileChange,
} from "../src/change-marks.js";
import { repositoryFrom } from "./repository-from.js";

function selectionOf(extensions: string[]) {
  return {
    extensions,
    skipDirectoryNames: ["test", "tests"],
    skipDirectoryPrefixes: [],
    skipDirectorySuffixes: [],
    skipDirectoriesContaining: [],
    skipFileGlobs: [],
  };
}

function documentSelection(extensions: string[]) {
  return {
    extensions,
    skip_directory_names: ["test", "tests"],
    skip_directory_prefixes: [],
    skip_directory_suffixes: [],
    skip_directories_containing: [],
    skip_file_globs: [],
  };
}

function scan(
  modules: [string, "module" | "package"][],
  extensions = [".py", ".kt"],
): Repository {
  return repositoryFrom({
    modules: modules.map(([id, kind]) => ({ id, kind })),
    selection: documentSelection(extensions),
  });
}

const selectionsOf = (repository: Repository) =>
  repository.extractions.map((one) => one.selection);

const current = scan([
  ["src/a.py", "module"],
  ["src/c.py", "module"],
]);
const base = scan([
  ["src/a.py", "module"],
  ["src/b.py", "module"],
]);

describe("changeMarks", () => {
  it("marks an added module with a current box", () => {
    expect(
      changeMarks([{ status: "A", path: "src/c.py" }], current, base),
    ).toEqual({
      files: [{ id: "src/c.py", mark: "added", box: "current" }],
      unmatched: 0,
    });
  });

  it("marks a modified module", () => {
    expect(
      changeMarks([{ status: "M", path: "src/a.py" }], current, base).files,
    ).toEqual([{ id: "src/a.py", mark: "modified", box: "current" }]);
  });

  it("draws a removed module from the base scan", () => {
    expect(
      changeMarks([{ status: "D", path: "src/b.py" }], current, base).files,
    ).toEqual([{ id: "src/b.py", mark: "removed", box: "base" }]);
  });

  it("lists a removed module with no box when there is no base scan", () => {
    expect(
      changeMarks([{ status: "D", path: "src/b.py" }], current, null).files,
    ).toEqual([{ id: "src/b.py", mark: "removed", box: "none" }]);
  });

  it("ignores a path whose extension is not selected", () => {
    expect(
      changeMarks([{ status: "A", path: "README.md" }], current, base),
    ).toEqual({
      files: [],
      unmatched: 0,
    });
  });

  it("counts a selected path that matches no module", () => {
    expect(
      changeMarks([{ status: "A", path: "src/zz.py" }], current, base),
    ).toEqual({
      files: [],
      unmatched: 1,
    });
  });

  it("returns matches and counts the rest in a mixed set", () => {
    const result = changeMarks(
      [
        { status: "M", path: "src/a.py" },
        { status: "A", path: "src/zz.py" },
      ],
      current,
      base,
    );

    expect(result.files).toHaveLength(1);
    expect(result.unmatched).toBe(1);
  });
});

describe("classifyChanges", () => {
  const changes: FileChange[] = [
    { status: "A", path: "src/c.py" },
    { status: "M", path: "src/a.py" },
    { status: "T", path: "src/a.py" },
    { status: "D", path: "src/b.py" },
    { status: "D", path: "docs/x.md" },
    { status: "A", path: "src/new.py" },
    { status: "M", path: "README.md" },
    { status: "M", path: "src/A.py" },
  ];

  it("splits changes into added, modified, removed and elsewhere by name", () => {
    expect(classifyChanges(changes, selectionsOf(current))).toEqual({
      added: ["src/c.py", "src/new.py"],
      modified: ["src/a.py", "src/a.py", "src/A.py"],
      renamed: [],
      removed: ["src/b.py"],
      elsewhere: ["docs/x.md", "README.md"],
    });
  });

  it("classifyChanges counts a deleted selected file as removed even when the checked-out scan still has it", () => {
    expect(
      classifyChanges(
        [{ status: "D", path: "src/a.py" }],
        selectionsOf(current),
      ),
    ).toEqual({
      added: [],
      modified: [],
      renamed: [],
      removed: ["src/a.py"],
      elsewhere: [],
    });
  });

  it("does not filter by extension when no extensions are selected", () => {
    expect(
      classifyChanges([{ status: "M", path: "notes.md" }], []).modified,
    ).toEqual(["notes.md"]);
  });

  it("counts modules from every scan", () => {
    const both = Repository.join([current, scan([["lib/z.kt", "module"]])]);

    expect(
      classifyChanges([{ status: "A", path: "lib/z.kt" }], selectionsOf(both))
        .added,
    ).toEqual(["lib/z.kt"]);
  });

  it("puts on the canvas exactly the modules changeMarks marks current", () => {
    const readable = changes.filter(
      (one) => one.path !== "src/new.py" && one.path !== "src/A.py",
    );
    const onCanvas = classifyChanges(readable, selectionsOf(current));
    const marked = changeMarks(readable, current, base)
      .files.map((one) => one.id)
      .sort();

    expect(
      [
        ...new Set([
          ...onCanvas.added,
          ...onCanvas.modified,
          ...onCanvas.renamed,
          ...onCanvas.removed,
        ]),
      ].sort(),
    ).toEqual(marked);
  });

  it("classifyChanges and changeMarks agree on a deleted test file: elsewhere in both", () => {
    const gone: FileChange[] = [{ status: "D", path: "test/test_gone.py" }];

    expect(changeMarks(gone, current, base).files).toEqual([]);
    expect(classifyChanges(gone, selectionsOf(current)).elsewhere).toEqual([
      "test/test_gone.py",
    ]);
  });
});

describe("changeMarks over a recorded name-status list", () => {
  const recorded = JSON.parse(
    readFileSync(
      new URL("../../../fixtures/views/name-status-m.json", import.meta.url),
      "utf8",
    ),
  ) as { stdout: string };
  const changes = parseNameStatus(recorded.stdout);
  const head = scan([
    ["src/mod.py", "module"],
    ["src/added.py", "module"],
    ["src/new.py", "module"],
  ]);
  const before = scan([
    ["src/mod.py", "module"],
    ["src/gone.py", "module"],
    ["src/old.py", "module"],
  ]);

  it("marks each src file once with its status and keeps every test file off the canvas", () => {
    expect(changes).toHaveLength(8);

    const marks = changeMarks(changes, head, before);

    expect(marks.files).toEqual([
      { id: "src/added.py", mark: "added", box: "current" },
      { id: "src/gone.py", mark: "removed", box: "base" },
      { id: "src/mod.py", mark: "modified", box: "current" },
      { id: "src/new.py", mark: "renamed", box: "current", from: "src/old.py" },
    ]);
    expect(marks.unmatched).toBe(0);
    expect(marks.files.some((one) => one.id === "src/old.py")).toBe(false);

    const classified = classifyChanges(changes, selectionsOf(head));

    expect(classified.elsewhere.sort()).toEqual([
      "test/test_added.py",
      "test/test_gone.py",
      "test/test_mod.py",
      "test/test_new.py",
    ]);
    expect(
      classified.added.length +
        classified.modified.length +
        classified.renamed.length +
        classified.removed.length,
    ).toBe(marks.files.length);
  });

  it("counts a file that is a module in neither scan as unmatched and marks the one that is", () => {
    const result = changeMarks(
      [
        { status: "A", path: "src/added.py" },
        { status: "A", path: "src/lost.py" },
      ],
      head,
      before,
    );

    expect(result.files).toEqual([
      { id: "src/added.py", mark: "added", box: "current" },
    ]);
    expect(result.unmatched).toBe(1);
  });
});

describe("ScanSelection.accepts", () => {
  const parity = JSON.parse(
    readFileSync(
      new URL("../../../fixtures/selection-parity.json", import.meta.url),
      "utf8",
    ),
  ) as Record<string, { tree: string[]; accepted: string[] }>;

  for (const language of Object.keys(parity)) {
    it(`accepts exactly the ${language} files the scanner reads`, () => {
      const expected = JSON.parse(
        readFileSync(
          new URL(
            `../../../fixtures/${language}/expected-scan.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      ) as { selection: Record<string, unknown> };
      const tree = new Set(parity[language]?.tree);
      const accepted = [...tree]
        .filter((path) =>
          new ScanSelection(
            repositoryFrom({ modules: [], selection: expected.selection })
              .extractions[0]?.selection as never,
          ).accepts(path, tree),
        )
        .sort();

      expect(accepted).toEqual(parity[language]?.accepted);
    });
  }

  it("rejects a path under skip_paths", () => {
    const selection = { ...selectionOf([".py"]), skipPaths: ["vendor"] };

    expect(new ScanSelection(selection).accepts("vendor/a.py")).toBe(false);
    expect(new ScanSelection(selection).accepts("vendor2/a.py")).toBe(true);
  });
});

describe("classifyOpened", () => {
  it("classifyOpened counts only files with a node", () => {
    const csharp = {
      ...documentSelection([".cs", ".py"]),
      skip_directory_names: [],
    };
    const head = repositoryFrom({
      modules: [{ id: "src/a.py", kind: "module" }],
      selection: csharp,
    });
    const changes: FileChange[] = [
      { status: "A", path: "src/a.py" },
      { status: "M", path: "Tests/T.cs" },
      { status: "A", path: "src/ghost.py" },
      { status: "D", path: "src/gone.py" },
    ];

    expect(changes).toHaveLength(4);

    const found = changeMarks(changes, head, null);
    const result = classifyOpened(changes, found.files);

    expect(result.added).toEqual(["src/a.py"]);
    expect(result.elsewhere).toEqual([
      "Tests/T.cs",
      "src/ghost.py",
      "src/gone.py",
    ]);
    expect(
      result.added.length +
        result.modified.length +
        result.renamed.length +
        result.removed.length,
    ).toBe(found.files.filter((one) => one.box !== "none").length);
  });
});
