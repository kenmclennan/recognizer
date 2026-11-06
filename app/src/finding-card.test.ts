import type { FindingRecord } from "recognizer";
import { describe, expect, it } from "vitest";
import { cardOf, isAbsent } from "./finding-card";
import { findingRows } from "./findings-order";

function rowOf(partial: Partial<FindingRecord>) {
  const [row] = findingRows([
    {
      findings_version: 1,
      sensor: { name: "s", version: "1" },
      commit: "c",
      modified: false,
      settings: {},
      findings: [
        {
          id: "x",
          kind: "cycle",
          severity: "warning",
          principle: "p",
          summary: "sum",
          evidence: { modules: [] },
          ...partial,
        },
      ],
    },
  ]);

  return row as NonNullable<typeof row>;
}

describe("cardOf subject", () => {
  it("names a module finding by its file name and folder", () => {
    const card = cardOf(
      rowOf({
        kind: "orphan",
        evidence: { modules: ["app/adapters/audit.py"] },
      }),
    );

    expect([card.name, card.folder]).toEqual(["audit.py", "app/adapters"]);
  });

  it("leaves the folder empty for a top-level module", () => {
    expect(
      cardOf(rowOf({ kind: "orphan", evidence: { modules: ["main.py"] } }))
        .folder,
    ).toBe("");
  });

  it("names a member finding by its first member and that module's folder", () => {
    const card = cardOf(
      rowOf({
        kind: "crap",
        evidence: {
          modules: ["src/footer.py"],
          members: [{ module: "src/footer.py", name: "StatusBar.report" }],
        },
      }),
    );

    expect([card.name, card.folder]).toEqual(["StatusBar.report", "src"]);
  });

  it("names a folder finding by the folder it is about", () => {
    const card = cardOf(
      rowOf({
        id: "folder_cycle:lightcycle/adapters,lightcycle",
        kind: "folder_cycle",
        evidence: { modules: ["lightcycle/adapters/a.py"] },
      }),
    );

    expect([card.name, card.folder]).toEqual(["adapters", "lightcycle"]);
  });

  it("names a policy drift entry by its glob with no folder", () => {
    const card = cardOf(
      rowOf({
        id: "policy_drift:entry:src/legacy/**",
        kind: "policy_drift",
        evidence: { modules: [] },
      }),
    );

    expect([card.name, card.folder]).toEqual(["src/legacy/**", ""]);
  });
});

describe("cardOf rows", () => {
  it("lists the cuts in rank order and no modules for a folder cycle", () => {
    const card = cardOf(
      rowOf({
        id: "folder_cycle:a,b",
        kind: "folder_cycle",
        evidence: {
          modules: ["a/x.py", "b/y.py"],
          edges: [
            { from: "a/x.py", to: "b/y.py" },
            { from: "b/y.py", to: "a/x.py" },
          ],
          cuts: [
            { from: "b/y.py", to: "a/x.py" },
            { from: "a/x.py", to: "b/y.py" },
          ],
        },
      }),
    );

    expect(card.rows).toEqual([
      { kind: "edge", from: "b/y.py", to: "a/x.py" },
      { kind: "edge", from: "a/x.py", to: "b/y.py" },
    ]);
  });

  it("keeps the module and edge rows for a folder cycle without cuts", () => {
    const card = cardOf(
      rowOf({
        id: "folder_cycle:a,b",
        kind: "folder_cycle",
        evidence: {
          modules: ["a/x.py", "b/y.py"],
          edges: [{ from: "a/x.py", to: "b/y.py" }],
        },
      }),
    );

    expect(card.rows.map((row) => row.kind)).toEqual([
      "module",
      "module",
      "edge",
    ]);
  });

  it("lists modules then edges for an edge finding", () => {
    const card = cardOf(
      rowOf({
        evidence: {
          modules: ["a/x.py", "a/y.py"],
          edges: [
            { from: "a/x.py", to: "a/y.py" },
            { from: "a/y.py", to: "a/x.py" },
          ],
        },
      }),
    );

    expect(card.rows).toEqual([
      { kind: "module", module: "a/x.py", name: "x.py", folder: "a" },
      { kind: "module", module: "a/y.py", name: "y.py", folder: "a" },
      { kind: "edge", from: "a/x.py", to: "a/y.py" },
      { kind: "edge", from: "a/y.py", to: "a/x.py" },
    ]);
  });

  it("lists one member row per member for a duplication finding", () => {
    const card = cardOf(
      rowOf({
        kind: "duplication",
        evidence: {
          modules: ["s/items.py", "s/steps.py"],
          members: [
            { module: "s/items.py", name: "parse_item" },
            { module: "s/steps.py", name: "parse_step" },
          ],
        },
      }),
    );

    expect(card.rows.map((row) => row.kind)).toEqual(["member", "member"]);
    expect(card.rows[1]).toEqual({
      kind: "member",
      module: "s/steps.py",
      name: "parse_step",
      folder: "s",
    });
  });

  it("does not cap a 40-edge folder cycle", () => {
    const edges = Array.from({ length: 40 }, (_, i) => ({
      from: `a/m${i}.py`,
      to: `b/m${i}.py`,
    }));

    expect(
      cardOf(
        rowOf({
          kind: "folder_cycle",
          id: "folder_cycle:a,b",
          evidence: { modules: [], edges },
        }),
      ).rows,
    ).toHaveLength(40);
  });
});

describe("isAbsent", () => {
  const card = cardOf(
    rowOf({
      evidence: {
        modules: ["a/x.py", "b/y.py", "c/z.py"],
        edges: [{ from: "a/x.py", to: "b/y.py" }],
      },
    }),
  );
  const folded = (id: string) => (id.startsWith("c/") ? "c" : id);
  const boxes = new Set(["a/x.py", "c"]);

  it("is true only for module rows with no box, and counts a folded folder as on the view", () => {
    expect(card.rows.map((row) => isAbsent(row, folded, boxes))).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });

  it("shows it on none when every module is present and on every module row when none is", () => {
    const all = new Set(["a/x.py", "b/y.py", "c"]);

    expect(card.rows.some((row) => isAbsent(row, folded, all))).toBe(false);
    expect(
      card.rows
        .filter((row) => row.kind !== "edge")
        .every((row) => isAbsent(row, (id) => id, new Set())),
    ).toBe(true);
  });
});
