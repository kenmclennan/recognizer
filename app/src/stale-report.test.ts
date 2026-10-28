import type { Scan, View } from "recognizer";
import { describe, expect, it } from "vitest";
import { expectedScan } from "./fixtures";
import { currentCommit, hasEntries, staleReport } from "./stale-report";

type Committed = Scan & { commit: string | null };

const place = "shop/application/place.py";
const order = "shop/domain/order.py";
const store = "shop/ports/store.py";
const refund = "shop/application/refund.py";
const refunds = "shop/application/refunds.py";
const fresh = "shop/application/newcomer.py";

function original(): Committed {
  return { ...expectedScan("python"), commit: "abc1234" };
}

function derived(): Committed {
  const base = original();

  return {
    ...base,
    commit: "def5678",
    modules: [
      ...base.modules.map((module) =>
        module.id === refund ? { ...module, id: refunds } : module,
      ),
      { id: fresh, kind: "module" },
    ],
    edges: [
      ...base.edges
        .filter((edge) => !(edge.from === place && edge.to === order))
        .map((edge) =>
          edge.from === refund ? { ...edge, from: refunds } : edge,
        ),
      { from: order, to: store, kind: "depends", line: 1 },
      { from: fresh, to: order, kind: "depends", line: 1 },
    ],
  };
}

const view = (
  steps: View["steps"],
  commit: string | null = "abc1234",
): View => ({
  schema_version: 1,
  description: "d",
  commit,
  steps,
});

const picks = (...modules: string[]): View["steps"] =>
  modules.map((module) => ({ kind: "pick", module }));

describe("staleReport", () => {
  it("lists a missing pick with the rename git records", () => {
    const report = staleReport({
      view: view(picks(refund, place)),
      now: [derived()],
      before: [original()],
      renames: [{ from: refund, to: refunds }],
    });

    expect(report.missing).toEqual([
      { step: 1, kind: "pick", path: refund, renamedTo: refunds },
    ]);
  });

  it("reports removed and added relations among the view's modules and the newly relevant ones", () => {
    const report = staleReport({
      view: view(picks(place, order, store)),
      now: [derived()],
      before: [original()],
      renames: [],
    });

    expect(report.unavailable).toBeNull();
    expect(report.changed?.removed).toEqual([
      { from: place, to: order, kind: "depends" },
    ]);
    expect(report.changed?.added).toEqual([
      { from: order, to: store, kind: "depends" },
    ]);
    expect(report.newlyRelevant).toContain(fresh);
    expect(report.newlyRelevant).not.toContain(place);
  });

  it("is unknown, never healthy, when the earlier scan is unavailable", () => {
    const report = staleReport({
      view: view(picks(place)),
      now: [derived()],
      before: null,
      renames: [],
    });

    expect(report.changed).toBeNull();
    expect(report.newlyRelevant).toBeNull();
    expect(report.unavailable).toBe("commit abc1234 could not be scanned");
    expect(hasEntries(report)).toBe(true);
  });

  it("names a view without a commit", () => {
    const report = staleReport({
      view: view(picks(place), null),
      now: [derived()],
      before: null,
      renames: [],
    });

    expect(report.unavailable).toBe("view has no commit");
  });

  it("has empty sections when the view's commit is the current one", () => {
    const report = staleReport({
      view: view(picks(place, refund), "def5678"),
      now: [derived()],
      before: null,
      renames: [],
    });

    expect(report.changed).toEqual({ removed: [], added: [] });
    expect(report.newlyRelevant).toEqual([]);
    expect(report.unavailable).toBeNull();
    expect(report.missing).toHaveLength(1);
  });

  it("lists a rename, a plain missing path and a missing path whose rename target is absent", () => {
    const report = staleReport({
      view: view(picks(refund, "shop/gone.py", "shop/moved.py", place)),
      now: [derived()],
      before: [original()],
      renames: [
        { from: refund, to: refunds },
        { from: "shop/moved.py", to: "shop/nowhere.py" },
      ],
    });

    expect(report.missing.map((m) => [m.path, m.renamedTo])).toEqual([
      [refund, refunds],
      ["shop/gone.py", null],
      ["shop/moved.py", null],
    ]);
  });

  it("reads the current commit from the scans", () => {
    expect(currentCommit([derived()])).toBe("def5678");
    expect(currentCommit([expectedScan("python")])).toBeNull();
  });
});
