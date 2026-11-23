import { describe, expect, it } from "vitest";
import {
  Finding,
  InvalidEntity,
  WARNING_KINDS,
  Warning,
  type WarningFields,
} from "../../src/index.js";

const BY_KIND: Record<string, WarningFields> = {
  cycle: {
    kind: "cycle",
    id: "cycle:a.py,b.py",
    principle: "levelization",
    fixPattern: "break-cycle",
    summary: "cycle of 2 files: a.py, b.py",
    files: ["a.py", "b.py"],
    dependencies: [
      { from: "a.py", to: "b.py" },
      { from: "b.py", to: "a.py" },
    ],
  },
  orphan: {
    kind: "orphan",
    id: "orphan:a.py",
    principle: "dead-code",
    fixPattern: "move-orphan-to-tests",
    summary: "a.py is imported by no file",
    files: ["a.py"],
    testImporters: [{ file: "t_a.py", names: ["f"] }],
  },
  unused_exports: {
    kind: "unused_exports",
    id: "unused_exports:a.py",
    principle: "information-hiding",
    fixPattern: "narrow-exports",
    summary: "a.py exports 1 name no other file imports: f",
    files: ["a.py"],
    members: [{ file: "a.py", name: "f", sourceFile: "a.py", lines: [1, 1] }],
  },
  private_imports: {
    kind: "private_imports",
    id: "private_imports:b.py",
    principle: "information-hiding",
    summary: "b.py imports 1 private name from 1 file (a.py)",
    files: ["b.py"],
    members: [{ file: "a.py", name: "_f" }],
    dependencies: [{ from: "b.py", to: "a.py", kind: "depends", lines: [2] }],
  },
  long_function: {
    kind: "long_function",
    id: "long_function:a.py::f",
    principle: "small-functions",
    summary: "f is 90 lines, over the limit of 60",
    files: ["a.py"],
    members: [{ file: "a.py", name: "f", sourceFile: "a.py", lines: [1, 90] }],
    measures: { lines: 90, limit: 60 },
  },
  duplication: {
    kind: "duplication",
    id: "duplication:a.py::f|b.py::g",
    principle: "dont-repeat-yourself",
    fixPattern: "extract-shared-function",
    summary: "f in a.py is 90% similar to g in b.py",
    files: ["a.py", "b.py"],
    members: [
      { file: "a.py", name: "f", sourceFile: "a.py", lines: [1, 20] },
      { file: "b.py", name: "g", sourceFile: "b.py", lines: [1, 20] },
    ],
    measures: { similarity: 0.9 },
  },
  complexity: {
    kind: "complexity",
    id: "complexity:a.py::f",
    principle: "cyclomatic-complexity-limit",
    summary: "f has complexity 12, over the limit of 10",
    files: ["a.py"],
    members: [{ file: "a.py", name: "f", sourceFile: "a.py", lines: [1, 30] }],
    measures: { complexity: 12, limit: 10 },
  },
};

describe("Warning", () => {
  it("round-trips a warning of every kind through its finding", () => {
    expect(WARNING_KINDS).toHaveLength(7);

    for (const kind of WARNING_KINDS) {
      const warning = new Warning(BY_KIND[kind] as WarningFields);
      const finding = warning.toFinding();

      expect(finding.severity).toBe("warning");
      expect(finding.kind).toBe(kind);
      expect(Warning.ofFinding(finding)).toEqual(warning);
    }
  });

  it("turns a record it cannot read into null", () => {
    const record = (fields: Partial<Parameters<typeof Finding.stored>[0]>) =>
      Finding.stored({
        id: "orphan:a.py",
        kind: "orphan",
        severity: "warning",
        principle: "dead-code",
        summary: "s",
        files: ["a.py"],
        ...fields,
      });

    expect(Warning.ofFinding(record({}))).toBeInstanceOf(Warning);
    expect(
      Warning.ofFinding(record({ id: "crap:a.py", kind: "crap" })),
    ).toBeNull();
    expect(Warning.ofFinding(record({ files: [] }))).toBeNull();
    expect(Warning.ofFinding(record({ severity: "violation" }))).toBeNull();
  });

  it("refuses an id that does not start with its kind", () => {
    expect(
      () =>
        new Warning({
          kind: "orphan",
          id: "cycle:a",
          principle: "dead-code",
          summary: "s",
          files: ["a"],
        }),
    ).toThrow(InvalidEntity);
  });
});
