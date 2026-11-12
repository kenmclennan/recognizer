import type { MarkedModule, Scan } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  drawnScans,
  headDrawn,
  withoutDrawn,
  withoutDrawnResponsibility,
} from "./head-drawn";
import type { OverlayModel } from "./overlay-model";

const HEAD = "head1";
const marked: MarkedModule[] = [
  { id: "p/a.py", mark: "modified", box: "current" },
  { id: "p/b.py", mark: "modified", box: "current" },
];
const marks = new Map<string, Map<string, "added"> | null>([
  ["p/a.py", new Map([["helper", "added"]])],
  ["p/b.py", null],
]);

function scanOf(
  members: string[],
  extra: { commit: string; modified: boolean | null },
): Scan {
  return {
    ...extra,
    modules: ["p/a.py", "p/b.py"].map((id) => ({
      id,
      kind: "module" as const,
      members: members.map((name, index) => ({
        name,
        exported: true,
        kind: "function" as const,
        line: index + 1,
      })),
    })),
    edges: [],
    foreign: [],
  } as unknown as Scan;
}

const head = [scanOf(["helper"], { commit: HEAD, modified: false })];

function model(): OverlayModel {
  const values = { "p/a.py::helper": 3, "p/b.py::f": 5 };

  return {
    groups: [],
    unreadable: [],
    metrics: [
      {
        name: "crap",
        title: "C.R.A.P.",
        granularity: "member",
        values,
        max: 5,
      },
    ],
  } as unknown as OverlayModel;
}

function drawnFor(scans: Scan[]) {
  return headDrawn({ scans, headCommit: HEAD, marked, marks, head });
}

describe("head-drawn", () => {
  it("drops the values of a head-drawn module when the checkout differs", () => {
    const drawn = drawnFor([
      scanOf(["other"], { commit: "else", modified: false }),
    ]);

    expect(Object.keys(model().metrics[0].values).sort()).toEqual([
      "p/a.py::helper",
      "p/b.py::f",
    ]);
    expect([...drawn]).toEqual(["p/a.py"]);

    const kept = withoutDrawn(model(), drawn).metrics[0];

    expect(kept.values).toEqual({ "p/b.py::f": 5 });
    expect(kept.max).toBe(5);
  });

  it("changes nothing when the checkout is the clean head", () => {
    const drawn = drawnFor([scanOf(["x"], { commit: HEAD, modified: false })]);

    expect(drawn.size).toBe(0);
    expect(withoutDrawn(model(), drawn)).toEqual(model());
  });

  it("drops the values when the checkout is at the head but modified or unknown", () => {
    for (const modified of [true, null]) {
      const drawn = drawnFor([scanOf(["x"], { commit: HEAD, modified })]);

      expect([...drawn]).toEqual(["p/a.py"]);
      expect(withoutDrawn(model(), drawn).metrics[0].values).toEqual({
        "p/b.py::f": 5,
      });
    }
  });

  it("replaces a drawn module's entry with the head scan's and keeps the rest", () => {
    const scans = [scanOf(["other"], { commit: "else", modified: false })];
    const out = drawnScans(scans, new Set(["p/a.py"]), head);

    expect(out[0].modules[0].members?.map((m) => m.name)).toEqual(["helper"]);
    expect(out[0].modules[1].members?.map((m) => m.name)).toEqual(["other"]);
  });
});

describe("head-drawn responsibility", () => {
  const checkout = (id: string) => ({
    state: { kind: "current" as const, line: `checkout ${id}` },
    failure: null,
  });

  it("shows no responsibility line for a head-drawn file when the checkout differs", () => {
    const drawn = drawnFor([
      scanOf(["other"], { commit: "else", modified: false }),
    ]);
    const of = withoutDrawnResponsibility(checkout, drawn);

    expect(of("p/a.py")).toEqual({ state: { kind: "missing" }, failure: null });
    expect(of("p/b.py").state).toEqual({
      kind: "current",
      line: "checkout p/b.py",
    });
  });

  it("shows the description as today when the checkout is the clean head", () => {
    const drawn = drawnFor([scanOf(["x"], { commit: HEAD, modified: false })]);
    const of = withoutDrawnResponsibility(checkout, drawn);

    expect(of).toBe(checkout);
    expect(of("p/a.py").state).toEqual({
      kind: "current",
      line: "checkout p/a.py",
    });
  });

  it("never reads the checkout's description for a drawn file", () => {
    const drawn = drawnFor([
      scanOf(["other"], { commit: "else", modified: false }),
    ]);
    const calls: string[] = [];
    const of = withoutDrawnResponsibility((id) => {
      calls.push(id);

      return checkout(id);
    }, drawn);

    of("p/a.py");

    expect(calls).toEqual([]);
  });
});
