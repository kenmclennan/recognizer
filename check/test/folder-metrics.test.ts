import { describe, expect, it } from "vitest";
import { measureFolders } from "../src/folder-metrics.js";
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
      folder("app/contracts", 1, 0, 1, 1, 1, 1, 1, 1),
      folder("app/domain", 2, 1, 1, 0.5, 2, 0, 0, 0.5),
      folder("app/ports", 1, 2, 0, 0, 2, 2, 1, 0),
      folder("app/util", 2, 1, 2, 0.6667, 2, 0, 0, 0.3333),
    ]);
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

function folder(
  id: string,
  modules: number,
  afferent: number,
  efferent: number,
  instability: number,
  exported: number,
  abstract: number,
  abstractness: number,
  distance: number,
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
