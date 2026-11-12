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
});

describe("cardOf orphan test importers", () => {
  const orphan = (test_importers?: { file: string; names: string[] }[]) =>
    cardOf(
      rowOf({
        kind: "orphan",
        evidence: {
          modules: ["app/fake.py"],
          ...(test_importers ? { test_importers } : {}),
        },
      }),
    );

  it("adds one test row per file after the module row, in order", () => {
    const card = orphan([
      { file: "tests/unit/test_a.py", names: ["Fake"] },
      { file: "tests/test_b.py", names: [] },
    ]);

    expect(card.sentence).toContain("imported only by 2 test files");
    expect(card.rows).toEqual([
      { kind: "module", module: "app/fake.py", name: "fake.py", folder: "app" },
      {
        kind: "test",
        file: "tests/unit/test_a.py",
        name: "test_a.py",
        folder: "tests/unit",
        names: ["Fake"],
      },
      {
        kind: "test",
        file: "tests/test_b.py",
        name: "test_b.py",
        folder: "tests",
        names: [],
      },
    ]);
  });

  it("never marks a test row absent from the canvas", () => {
    const rows = orphan([{ file: "tests/test_a.py", names: [] }]).rows;

    expect(rows.map((row) => isAbsent(row, (id) => id, new Set()))).toEqual([
      true,
      false,
    ]);
  });

  it("keeps today's rows and sentence without test importers", () => {
    const card = orphan();

    expect(card.rows).toEqual([
      { kind: "module", module: "app/fake.py", name: "fake.py", folder: "app" },
    ]);
    expect(card.sentence).toBe(
      "fake.py is imported by nothing and is not an entry point; a library can list its public API in warnings.orphan.entry_points.",
    );
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

describe("cardOf unused_exports test rows", () => {
  const unused = (members: { name: string; test_files?: string[] }[]) =>
    cardOf(
      rowOf({
        kind: "unused_exports",
        evidence: {
          modules: ["app/plan.py"],
          members: members.map((member) => ({
            module: "app/plan.py",
            ...member,
          })),
        },
      }),
    );

  it("adds one sorted test row per file with the marked names it imports", () => {
    const rows = unused([
      { name: "a", test_files: ["tests/test_b.py", "tests/test_a.py"] },
      { name: "b", test_files: ["tests/test_b.py"] },
      { name: "c" },
    ]).rows.filter((row) => row.kind === "test");

    expect(rows).toEqual([
      {
        kind: "test",
        file: "tests/test_a.py",
        name: "test_a.py",
        folder: "tests",
        names: ["a"],
      },
      {
        kind: "test",
        file: "tests/test_b.py",
        name: "test_b.py",
        folder: "tests",
        names: ["a", "b"],
      },
    ]);
  });

  it("adds no test row when nothing is marked", () => {
    expect(
      unused([{ name: "a" }]).rows.filter((row) => row.kind === "test"),
    ).toEqual([]);
  });
});
