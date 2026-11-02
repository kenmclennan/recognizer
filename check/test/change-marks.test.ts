import { describe, expect, it } from "vitest";
import type { MarkScan } from "../src/change-marks.js";
import { changeMarks, parseNameStatus } from "../src/change-marks.js";

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
    ["app/shop", "package"],
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

  it("marks a package modified when not every path is added", () => {
    expect(
      changeMarks(
        [
          { status: "A", path: "app/shop/New.kt" },
          { status: "M", path: "app/shop/Old.kt" },
        ],
        current,
        base,
      ).modules,
    ).toEqual([{ id: "app/shop", mark: "modified", box: "current" }]);
  });

  it("marks a package added when every path is added and base lacks it", () => {
    expect(
      changeMarks([{ status: "A", path: "app/shop/New.kt" }], current, base)
        .modules,
    ).toEqual([{ id: "app/shop", mark: "added", box: "current" }]);
  });

  it("marks a package that lost a file but remains as modified", () => {
    expect(
      changeMarks([{ status: "D", path: "app/shop/Old.kt" }], current, base)
        .modules,
    ).toEqual([{ id: "app/shop", mark: "modified", box: "current" }]);
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
