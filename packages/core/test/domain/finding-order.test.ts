import { describe, expect, it } from "vitest";
import {
  compareFindings,
  Finding,
  findingsHeader,
  findingsSeverity,
  findingsStanding,
} from "../../src/index.js";

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

describe("findingsSeverity", () => {
  const of = (...severities: ("violation" | "warning")[]) =>
    severities.map((severity) => ({ severity }));

  it("is a warning for an empty list and for warnings alone", () => {
    expect(findingsSeverity([])).toBe("warning");
    expect(findingsSeverity(of("warning"))).toBe("warning");
  });

  it("is a violation when one finding is a violation", () => {
    expect(findingsSeverity(of("warning", "violation", "warning"))).toBe(
      "violation",
    );
  });
});

describe("findingsHeader", () => {
  const counts = (violations: number, warnings: number) => [
    ...Array.from({ length: violations }, () => ({
      severity: "violation" as const,
    })),
    ...Array.from({ length: warnings }, () => ({
      severity: "warning" as const,
    })),
  ];

  it("omits a zero part and uses the singular for one", () => {
    expect(findingsHeader(counts(2, 104))).toBe("2 violations, 104 warnings");
    expect(findingsHeader(counts(0, 106))).toBe("106 warnings");
    expect(findingsHeader(counts(1, 0))).toBe("1 violation");
    expect(findingsHeader(counts(0, 1))).toBe("1 warning");
    expect(findingsHeader([])).toBeNull();
  });

  it("joins one violation and several warnings", () => {
    expect(findingsHeader(counts(1, 3))).toBe("1 violation, 3 warnings");
  });
});
