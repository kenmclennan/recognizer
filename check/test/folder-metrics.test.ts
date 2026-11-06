import { describe, expect, it } from "vitest";
import {
  type FolderMetrics,
  measureFolders,
  metricsLine,
  metricsTable,
} from "../src/folder-metrics.js";
import { parsePolicy } from "../src/index.js";
import { scanOf, WORKED, WORKED_EDGES } from "./folder-fixtures.js";

const row = (rows: ReturnType<typeof measureFolders>["rows"], id: string) =>
  rows.find((one) => one.id === id);

describe("measureFolders", () => {
  it("reproduces the worked example exactly", () => {
    const { rows } = measureFolders([scanOf(WORKED, WORKED_EDGES)], null);

    expect(rows).toEqual([
      folder("app/adapters", 1, 0, 1, 1, 1, 0, 0, 0),
      folder("app/application", 1, 0, 1, 1, 1, 0, 0, 0),
      folder("app/contracts", 1, 0, 0, null, 1, 1, 1, null),
      folder("app/domain", 2, 1, 1, 0.5, 2, 0, 0, 0.5),
      folder("app/ports", 1, 2, 0, 0, 2, 2, 1, 0),
      folder("app/util", 2, 1, 0, 0, 2, 0, 0, 1),
    ]);
  });

  it("adds nothing to efferent coupling for a foreign target", () => {
    const { rows } = measureFolders(
      [
        scanOf(
          [{ id: "c/z.ts" }, { id: "d/w.ts" }, { id: "e/v.ts" }],
          [
            ["c/z.ts", "foreign:os"],
            ["d/w.ts", "foreign:os"],
            ["e/v.ts", "d/w.ts"],
          ],
        ),
      ],
      null,
    );

    expect(row(rows, "c")).toMatchObject({
      afferent: 0,
      efferent: 0,
      instability: null,
      distance: null,
    });
    expect(row(rows, "d")).toMatchObject({
      afferent: 1,
      efferent: 0,
      instability: 0,
    });
    expect(row(rows, "e")).toMatchObject({
      afferent: 0,
      efferent: 1,
      instability: 1,
    });
  });

  it("keeps a and a/b as separate folders and uses . for a bare id", () => {
    const { rows } = measureFolders(
      [
        scanOf(
          [{ id: "a/x.ts" }, { id: "a/b/y.ts" }, { id: "z.ts" }],
          [["a/x.ts", "a/b/y.ts"]],
        ),
      ],
      null,
    );

    expect(rows.map((one) => one.id)).toEqual([".", "a", "a/b"]);
    expect(row(rows, "a")).toMatchObject({ afferent: 0, efferent: 1 });
    expect(row(rows, "a/b")).toMatchObject({ afferent: 1, efferent: 0 });
  });

  it("gives a module imported only inside its folder an afferent of 0", () => {
    const { rows } = measureFolders(
      [scanOf([{ id: "a/x.ts" }, { id: "a/y.ts" }], [["a/x.ts", "a/y.ts"]])],
      null,
    );

    expect(row(rows, "a")).toMatchObject({
      afferent: 0,
      efferent: 0,
      instability: null,
      distance: null,
    });
  });

  it("ignores self edges and inferred edges", () => {
    const { rows } = measureFolders(
      [
        scanOf([{ id: "a/x.ts" }, { id: "b/y.ts" }], [["a/x.ts", "a/x.ts"]], {
          inferred: [["a/x.ts", "b/y.ts"]],
        }),
      ],
      null,
    );

    expect(row(rows, "a")).toMatchObject({ afferent: 0, efferent: 0 });
    expect(row(rows, "b")).toMatchObject({ afferent: 0, efferent: 0 });
  });

  it("leaves ignored modules out", () => {
    const policy = parsePolicy("components:\n  a: a/**\nignore:\n  - b/**\n");
    const { rows } = measureFolders(
      [scanOf([{ id: "a/x.ts" }, { id: "b/y.ts" }], [["a/x.ts", "b/y.ts"]])],
      policy,
    );

    expect(rows.map((one) => one.id)).toEqual(["a"]);
    expect(row(rows, "a")).toMatchObject({ modules: 1, efferent: 0 });
  });

  it("counts abstract classes and skips non-exported and missing members", () => {
    const base = scanOf(
      [
        { id: "a/x.ts", exports: ["abstract", "class", "function"] },
        { id: "a/y.ts" },
      ],
      [],
    );
    base.modules[0]?.members?.push({
      name: "hidden",
      exported: false,
      kind: "interface",
    });

    const { rows } = measureFolders([base], null);

    expect(row(rows, "a")).toMatchObject({
      exported_members: 3,
      abstract_members: 1,
      abstractness: 0.3333,
    });
  });

  it("treats a plain type as concrete and counts only tagged types and classes", () => {
    const { rows } = measureFolders(
      [scanOf([{ id: "a/x.ts", exports: ["type"] }], [])],
      null,
    );

    expect(row(rows, "a")).toMatchObject({
      exported_members: 1,
      abstract_members: 0,
      abstractness: 0,
    });
  });

  it("counts a tagged type and a tagged class, and ignores other tags and unexported ones", () => {
    const base = scanOf(
      [{ id: "a/x.ts", exports: ["abstract-type", "abstract", "interface"] }],
      [],
    );
    const members = base.modules[0]?.members ?? [];

    members.push(
      { name: "s", exported: true, kind: "type", line: 9, tags: ["static"] },
      { name: "h", exported: false, kind: "type", line: 9, tags: ["abstract"] },
    );

    expect(row(measureFolders([base], null).rows, "a")).toMatchObject({
      exported_members: 4,
      abstract_members: 3,
    });
  });

  it("does not count a class without the abstract tag", () => {
    const { rows } = measureFolders(
      [scanOf([{ id: "a/x.ts", exports: ["class"] }], [])],
      null,
    );

    expect(row(rows, "a")).toMatchObject({ abstract_members: 0 });
  });

  it("measures a mixed folder as two abstract members of four", () => {
    const { rows } = measureFolders(
      [
        scanOf(
          [
            {
              id: "a/x.ts",
              exports: ["interface", "abstract-type", "type", "class"],
            },
          ],
          [],
        ),
      ],
      null,
    );

    expect(row(rows, "a")).toMatchObject({
      exported_members: 4,
      abstract_members: 2,
      abstractness: 0.5,
    });
  });

  it("leaves abstractness and distance null with no exported member", () => {
    const { rows } = measureFolders(
      [scanOf([{ id: "a/x.ts" }, { id: "b/y.ts" }], [["a/x.ts", "b/y.ts"]])],
      null,
    );

    expect(row(rows, "a")).toMatchObject({
      instability: 1,
      exported_members: 0,
      abstractness: null,
      distance: null,
    });
  });

  it("measures two scans with disjoint modules as one graph", () => {
    const { rows } = measureFolders(
      [
        scanOf([{ id: "a/x.ts" }], [["a/x.ts", "b/y.ts"]]),
        scanOf([{ id: "b/y.ts" }], []),
      ],
      null,
    );

    expect(row(rows, "a")).toMatchObject({ efferent: 1 });
    expect(row(rows, "b")).toMatchObject({ afferent: 1 });
  });
});

const sample = (
  abstractness: number | null,
  instability: number | null,
  distance: number | null,
): FolderMetrics => ({
  id: "a",
  modules: 1,
  afferent: 1,
  efferent: 1,
  instability,
  exported_members: 1,
  abstract_members: 0,
  abstractness,
  distance,
});

describe("metricsLine and metricsTable", () => {
  it("prints the three figures and no zone", () => {
    expect(metricsLine(sample(0.1, 0.5, 0.4))).toBe(
      "I 0.50 \u00b7 A 0.10 \u00b7 D 0.40",
    );
    expect(metricsLine(sample(null, 0.5, null))).toBe(
      "I 0.50 \u00b7 A unknown \u00b7 D unknown",
    );
  });

  it("ends the table on the distance row", () => {
    const table = metricsTable(sample(0.1, 0.8, 0.1));

    expect(table.at(-1)).toEqual(["Distance (D)", "0.10"]);
    expect(table.map(([name]) => name)).not.toContain("Zone");
  });
});

function folder(
  id: string,
  modules: number,
  afferent: number,
  efferent: number,
  instability: number | null,
  exported: number,
  abstract: number,
  abstractness: number,
  distance: number | null,
) {
  return {
    id,
    modules,
    afferent,
    efferent,
    instability,
    exported_members: exported,
    abstract_members: abstract,
    abstractness,
    distance,
  };
}
