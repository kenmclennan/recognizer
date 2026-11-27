import { describe, expect, it } from "vitest";
import { compareFindings, Finding, findingsStanding } from "../../src/index.js";

function record(
  id: string,
  kind: string,
  severity: "violation" | "warning",
  files: string[],
  members?: { file: string; name: string; lines: [number, number] }[],
): Finding {
  return Finding.stored({
    id,
    kind,
    severity,
    principle: "p",
    summary: `${kind} ${id}`,
    files,
    ...(members === undefined ? {} : { members }),
  });
}

const idsOf = (list: Finding[]) =>
  [...list].sort(compareFindings).map((f) => f.id);

describe("compareFindings", () => {
  it("orders violations before warnings, then kind, first file and id", () => {
    const list = [
      record("l1", "orphan", "warning", ["z.py"]),
      record("v2", "rule-violation", "violation", ["b.py"]),
      record("h1", "orphan", "warning", ["a.py"]),
      record("v3", "rule-violation", "violation", ["b.py"]),
      record("c1", "cycle", "warning", ["a.py"]),
      record("v1", "rule-violation", "violation", ["a.py"]),
    ];

    expect(list.length).toBeGreaterThan(0);
    expect(idsOf(list)).toEqual(["v1", "v2", "v3", "c1", "h1", "l1"]);
  });

  it("orders duplication by lines duplicated descending then id, after other kinds by kind", () => {
    const dup = (id: string, lines: [number, number]) =>
      record(
        id,
        "duplication",
        "warning",
        ["a.py"],
        [{ file: "a.py", name: "f", lines }],
      );
    const list = [
      dup("d-small", [1, 2]),
      dup("d-b", [1, 5]),
      record("c1", "crap", "warning", ["a.py"]),
      dup("d-big", [1, 50]),
      dup("d-a", [1, 5]),
    ];

    expect(idsOf(list)).toEqual(["c1", "d-big", "d-a", "d-b", "d-small"]);
  });

  it("puts a record with no files before one with a file within a kind", () => {
    const list = [
      record("with", "orphan", "warning", ["a.py"]),
      record("without", "orphan", "warning", []),
    ];

    expect(idsOf(list)).toEqual(["without", "with"]);
  });

  it("breaks a tie on equal id by input order", () => {
    const first = record("same", "orphan", "warning", ["a.py"]);
    const second = first.with({ summary: "second" });
    const sorted = [first, second].sort(compareFindings);

    expect(sorted[0]).toBe(first);
    expect(sorted[1]).toBe(second);
  });
});

describe("findingsStanding", () => {
  it("reads an empty list as none", () => {
    expect(findingsStanding([])).toEqual({ violations: 0, level: "none" });
  });

  it("reads a single warning as warning", () => {
    expect(findingsStanding([{ severity: "warning" }])).toEqual({
      violations: 0,
      level: "warning",
    });
  });

  it("reads a single violation as violation", () => {
    expect(findingsStanding([{ severity: "violation" }])).toEqual({
      violations: 1,
      level: "violation",
    });
  });

  it("counts violations when warnings are present too", () => {
    expect(
      findingsStanding([
        { severity: "violation" },
        { severity: "warning" },
        { severity: "violation" },
      ]),
    ).toEqual({ violations: 2, level: "violation" });
  });
});
