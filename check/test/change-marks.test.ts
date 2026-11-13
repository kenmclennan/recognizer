import { describe, expect, it } from "vitest";
import type { MarkScan } from "../src/change-marks.js";
import {
  changeMarks,
  classifyChanges,
  type FileChange,
  parseNameStatus,
} from "../src/change-marks.js";

function scan(
  modules: [string, "module" | "package"][],
  extensions = [".py", ".kt"],
): MarkScan {
  return {
    modules: modules.map(([id, kind]) => ({ id, kind })),
    selection: { extensions },
  } as MarkScan;
}

const current = [
  scan([
    ["src/a.py", "module"],
    ["src/c.py", "module"],
  ]),
];
const base = [
  scan([
    ["src/a.py", "module"],
    ["src/b.py", "module"],
  ]),
];

describe("parseNameStatus", () => {
  it("parses the measured -z output", () => {
    expect(parseNameStatus("D\0src/b.py\0A\0src/c.py\0")).toEqual({
      changes: [
        { status: "D", path: "src/b.py" },
        { status: "A", path: "src/c.py" },
      ],
      dropped: 0,
    });
  });

  it("drops and counts an unknown status letter", () => {
    expect(parseNameStatus("U\0x.py\0M\0y.py\0")).toEqual({
      changes: [{ status: "M", path: "y.py" }],
      dropped: 1,
    });
  });

  it("reads an empty string as no changes", () => {
    expect(parseNameStatus("")).toEqual({ changes: [], dropped: 0 });
  });
});

describe("changeMarks", () => {
  it("marks an added module with a current box", () => {
    expect(
      changeMarks([{ status: "A", path: "src/c.py" }], current, base),
    ).toEqual({
      modules: [{ id: "src/c.py", mark: "added", box: "current" }],
      unmatched: 0,
    });
  });

  it("marks a modified module", () => {
    expect(
      changeMarks([{ status: "M", path: "src/a.py" }], current, base).modules,
    ).toEqual([{ id: "src/a.py", mark: "modified", box: "current" }]);
  });

  it("draws a removed module from the base scan", () => {
    expect(
      changeMarks([{ status: "D", path: "src/b.py" }], current, base).modules,
    ).toEqual([{ id: "src/b.py", mark: "removed", box: "base" }]);
  });

  it("lists a removed module with no box when there is no base scan", () => {
    expect(
      changeMarks([{ status: "D", path: "src/b.py" }], current, null).modules,
    ).toEqual([{ id: "src/b.py", mark: "removed", box: "none" }]);
  });

  it("ignores a path whose extension is not selected", () => {
    expect(
      changeMarks([{ status: "A", path: "README.md" }], current, base),
    ).toEqual({
      modules: [],
      unmatched: 0,
    });
  });

  it("counts a selected path that matches no module", () => {
    expect(
      changeMarks([{ status: "A", path: "src/zz.py" }], current, base),
    ).toEqual({
      modules: [],
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

    expect(result.modules).toHaveLength(1);
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
    expect(classifyChanges(changes, current)).toEqual({
      added: ["src/c.py"],
      modified: ["src/a.py", "src/a.py"],
      removed: ["src/b.py"],
      elsewhere: ["docs/x.md", "src/new.py", "README.md", "src/A.py"],
    });
  });

  it("treats a deleted path that is still a current module as modified", () => {
    expect(
      classifyChanges([{ status: "D", path: "src/a.py" }], current),
    ).toEqual({
      added: [],
      modified: ["src/a.py"],
      removed: [],
      elsewhere: [],
    });
  });

  it("does not filter by extension when no extensions are selected", () => {
    const open = [scan([["notes.md", "module"]], [])];

    expect(
      classifyChanges([{ status: "M", path: "notes.md" }], open).modified,
    ).toEqual(["notes.md"]);
  });

  it("counts modules from every scan", () => {
    const both = [...current, scan([["lib/z.kt", "module"]])];

    expect(
      classifyChanges([{ status: "A", path: "lib/z.kt" }], both).added,
    ).toEqual(["lib/z.kt"]);
  });

  it("puts on the canvas exactly the modules changeMarks marks current", () => {
    const onCanvas = classifyChanges(changes, current);
    const marked = changeMarks(changes, current, base)
      .modules.filter((one) => one.box === "current")
      .map((one) => one.id)
      .sort();

    expect(
      [...new Set([...onCanvas.added, ...onCanvas.modified])].sort(),
    ).toEqual(marked);
  });

  it("counts a removed file the base scan lacked as removed where changeMarks gives it no box", () => {
    const gone: FileChange[] = [{ status: "D", path: "src/ghost.py" }];

    expect(changeMarks(gone, current, base).modules).toEqual([
      { id: "src/ghost.py", mark: "removed", box: "none" },
    ]);
    expect(classifyChanges(gone, current).removed).toEqual(["src/ghost.py"]);
  });
});
