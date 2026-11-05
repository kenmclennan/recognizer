import type { FindingRecord, FindingsDocument } from "recognizer";
import { describe, expect, it } from "vitest";
import { groupsOf, headerLine, staleNote } from "./findings-groups";
import { findingRows } from "./findings-order";
import { scopeCaption, scopedRows, scopeOf } from "./findings-scope";

function record(
  id: string,
  kind: string,
  modules: string[],
  severity: "violation" | "warning" = "warning",
): FindingRecord {
  return {
    id,
    kind,
    severity,
    principle: "p",
    summary: id,
    evidence: { modules },
  };
}

function rowsOf(findings: FindingRecord[], sensor = "structure") {
  const document: FindingsDocument = {
    findings_version: 1,
    sensor: { name: sensor, version: "1" },
    commit: "c",
    modified: false,
    settings: {},
    findings,
  };

  return findingRows([document]);
}

const view = scopeOf(["app/a.py", "app/b.py", "lib/c.py"]);

describe("which findings a view of three modules shows", () => {
  const rows = rowsOf([
    record("orphan:a", "orphan", ["app/a.py"]),
    record("orphan:z", "orphan", ["other/z.py"]),
    record("cycle:a,z", "cycle", ["other/y.py", "app/b.py"]),
    record("cycle:y,z", "cycle", ["other/y.py", "other/z.py"]),
    record("folder_cycle:app,other", "folder_cycle", [
      "app/a.py",
      "other/z.py",
    ]),
    record("folder_cycle:lib,other", "folder_cycle", ["other/z.py"]),
    record("folder_cycle:none,other", "folder_cycle", []),
  ]);

  it("keeps a finding about a module on the canvas", () => {
    expect(scopedRows(rows, view).map((row) => row.id)).toContain("orphan:a");
  });

  it("drops a finding about a module off the canvas", () => {
    expect(scopedRows(rows, view).map((row) => row.id)).not.toContain(
      "orphan:z",
    );
  });

  it("keeps a cycle when any one of its modules is on the canvas", () => {
    const ids = scopedRows(rows, view).map((row) => row.id);

    expect(ids).toContain("cycle:a,z");
    expect(ids).not.toContain("cycle:y,z");
  });

  it("keeps a folder finding when one of its modules is on the canvas", () => {
    const ids = scopedRows(rows, view).map((row) => row.id);

    expect(ids).toContain("folder_cycle:app,other");
  });

  it("drops a folder finding whose modules are all off the canvas while its folder is on it", () => {
    const ids = scopedRows(rows, view).map((row) => row.id);

    expect(ids).not.toContain("folder_cycle:lib,other");
    expect(ids).not.toContain("folder_cycle:none,other");
  });

  it("shows nothing when no module is on the canvas", () => {
    expect(scopedRows(rows, scopeOf([]))).toEqual([]);
  });
});

describe("counts over the shown findings only", () => {
  const rows = rowsOf([
    record("rule-violation:a", "rule-violation", ["app/a.py"], "violation"),
    record("orphan:a", "orphan", ["app/b.py"]),
    record("orphan:z", "orphan", ["other/z.py"]),
    record("hub:z", "hub", ["other/z.py"]),
  ]);
  const shown = scopedRows(rows, view);

  it("counts the header over the shown findings", () => {
    expect(headerLine(rows)).toBe("1 violation, 3 warnings");
    expect(headerLine(shown)).toBe("1 violation, 1 warning");
  });

  it("counts each group over the shown findings and hides an emptied group", () => {
    expect(
      groupsOf(shown).map((group) => [group.name, group.rows.length]),
    ).toEqual([
      ["Policy violation", 1],
      ["Orphan", 1],
    ]);
  });

  it("raises the out-of-date notice only for a sensor with hidden findings in scope", () => {
    const other = rowsOf([record("crap:z", "crap", ["other/z.py"])], "crap");
    const mine = rowsOf([record("crap:a", "crap", ["app/a.py"])], "crap");

    expect(staleNote(shown, mine, [])).toBe(
      "C.R.A.P. findings are out of date.",
    );
    expect(staleNote(shown, scopedRows(other, view), [])).toBeNull();
    expect(staleNote(shown, [], [])).toBeNull();
  });
});

describe("scopeCaption", () => {
  it("names the view and counts its modules", () => {
    expect(scopeCaption("engine-loop", 28)).toBe("engine-loop, 28");
    expect(scopeCaption(null, 1)).toBe("This canvas, 1");
  });
});
