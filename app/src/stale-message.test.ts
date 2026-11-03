import { describe, expect, it } from "vitest";
import { staleKey, staleMessage } from "./stale-message";
import type { StaleReport } from "./stale-report";

const edge = (from: string, to: string) => ({
  from,
  to,
  kind: "depends" as const,
});

const report = (parts: Partial<StaleReport>): StaleReport => ({
  missing: [],
  changed: { removed: [], added: [] },
  newlyRelevant: [],
  unavailable: null,
  ...parts,
});

const missing = (path: string, renamedTo: string | null = null, step = 1) => ({
  step,
  kind: "pick" as const,
  path,
  renamedTo,
});

const textOf = (parts: Partial<StaleReport>) =>
  staleMessage({
    name: "loop",
    title: "Engine loop",
    viewCommit: "c1933e0aaaa",
    scanCommit: "d2",
    report: report(parts),
  });

describe("staleMessage", () => {
  it("writes the mock's sentence for a rename, relation changes and a newly relevant module", () => {
    const message = textOf({
      missing: [missing("engine/loader.py", "engine/workflow_loader.py")],
      changed: {
        removed: [edge("a", "b")],
        added: [edge("a", "c"), edge("a", "d")],
      },
      newlyRelevant: ["engine/claim.py"],
    });

    expect(message).toEqual({
      kind: "warning",
      text: "Engine loop is out of date. Since c1933e0, loader.py was renamed to workflow_loader.py, 3 relations changed and claim.py became relevant.",
      key: "view-stale:loop:c1933e0aaaa:d2",
      update: true,
    });
  });

  it.each([
    [
      "many missing",
      { missing: [missing("a/x.py"), missing("a/y.py")] },
      "2 files are missing",
    ],
    [
      "one missing",
      { missing: [missing("lib/deleted.py")] },
      "deleted.py is missing",
    ],
    [
      "many renamed",
      {
        missing: [missing("a/x.py", "b/x.py"), missing("a/y.py", "b/y.py")],
      },
      "2 files were renamed",
    ],
    [
      "one relation",
      { changed: { removed: [edge("a", "b")], added: [] } },
      "1 relation changed",
    ],
    [
      "one newly relevant",
      { newlyRelevant: ["engine/claim.py"] },
      "claim.py became relevant",
    ],
    [
      "many newly relevant",
      { newlyRelevant: ["a", "b", "c"] },
      "3 modules became relevant",
    ],
    [
      "two clauses",
      {
        changed: { removed: [edge("a", "b")], added: [] },
        missing: [missing("a/x.py")],
      },
      "x.py is missing and 1 relation changed",
    ],
    [
      "three clauses",
      {
        missing: [missing("a/x.py")],
        changed: { removed: [edge("a", "b")], added: [] },
        newlyRelevant: ["n/m.py", "n/o.py"],
      },
      "x.py is missing, 1 relation changed and 2 modules became relevant",
    ],
    [
      "four clauses",
      {
        missing: [
          missing("a/x.py", "b/x.py"),
          missing("a/y.py", "b/y.py"),
          missing("lib/d.py"),
        ],
        changed: { removed: [edge("a", "b")], added: [] },
        newlyRelevant: ["n/m.py", "n/o.py"],
      },
      "2 files were renamed, d.py is missing, 1 relation changed and 2 modules became relevant",
    ],
  ])("joins %s", (_name, parts, clause) => {
    expect(textOf(parts)?.text).toBe(
      `Engine loop is out of date. Since c1933e0, ${clause}.`,
    );
  });

  it("says the commit could not be scanned, with no action", () => {
    expect(
      textOf({ unavailable: "x", changed: null, newlyRelevant: null }),
    ).toEqual({
      kind: "warning",
      text: "Could not compare Engine loop with c1933e0. That commit could not be scanned.",
      key: "view-stale:loop:c1933e0aaaa:d2",
      update: false,
    });
  });

  it("says the view has no commit and writes none into the key", () => {
    const message = staleMessage({
      name: "loop",
      title: "Engine loop",
      viewCommit: null,
      scanCommit: null,
      report: report({ unavailable: "view has no commit" }),
    });

    expect(message?.text).toBe(
      "Could not compare Engine loop. The view has no commit.",
    );
    expect(message?.key).toBe("view-stale:loop:none:none");
    expect(message?.update).toBe(false);
  });

  it("gives nothing when the report has no entries", () => {
    expect(textOf({})).toBeNull();
  });

  it("keys a view and a pair of commits", () => {
    expect(staleKey("a", "x", "y")).toBe("view-stale:a:x:y");
    expect(staleKey("a", null, "y")).toBe("view-stale:a:none:y");
  });
});
