import type { MarkedModule, Scan } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  addedFromHead,
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

describe("head-drawn renamed", () => {
  it("headDrawn includes a renamed module with marks held in the head scan", () => {
    const drawn = headDrawn({
      scans: [scanOf(["other"], { commit: "else", modified: false })],
      headCommit: HEAD,
      marked: [
        { id: "p/a.py", mark: "renamed", box: "current", from: "p/old.py" },
      ],
      marks: new Map([["p/a.py", new Map([["helper", "added"]])]]),
      head,
    });

    expect([...drawn]).toEqual(["p/a.py"]);
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

describe("head-drawn added", () => {
  const added: MarkedModule[] = [
    { id: "p/new.py", mark: "added", box: "current" },
    { id: "p/gone.py", mark: "added", box: "current" },
  ];
  const member = (name: string) =>
    ({ name, exported: true, kind: "function", line: 1 }) as never;
  const headScan: Scan = {
    modules: [
      { id: "p/new.py", kind: "module", members: [member("fresh")] },
      { id: "p/a.py", kind: "module", members: [member("fromHead")] },
    ],
    edges: [
      { from: "p/new.py", to: "p/a.py", kind: "import" },
      { from: "p/a.py", to: "p/new.py", kind: "import" },
    ],
    foreign: [],
  } as unknown as Scan;
  const checkout: Scan = {
    modules: [
      { id: "p/a.py", kind: "module", members: [member("fromCheckout")] },
    ],
    edges: [],
    foreign: [],
  } as unknown as Scan;
  const find = (scans: Scan[], id: string) =>
    scans.flatMap((scan) => scan.modules).find((entry) => entry.id === id);

  it("gives an added module absent from the checkout its head members", () => {
    expect(find([headScan], "p/new.py")?.members).toHaveLength(1);

    const result = addedFromHead([checkout], added.slice(0, 1), [headScan]);

    expect(find(result, "p/new.py")?.members).toEqual(
      find([headScan], "p/new.py")?.members,
    );
  });

  it("keeps the checkout entry for a module the checkout holds", () => {
    const marked: MarkedModule[] = [
      { id: "p/a.py", mark: "added", box: "current" },
    ];

    const scans = [checkout];

    expect(find(scans, "p/a.py")).not.toEqual(find([headScan], "p/a.py"));
    expect(addedFromHead(scans, marked, [headScan])).toBe(scans);
  });

  it("leaves out an added id the head lacks", () => {
    const result = addedFromHead([checkout], added, [headScan]);

    expect(find(result, "p/new.py")).toBeDefined();
    expect(find(result, "p/gone.py")).toBeUndefined();
  });

  it("returns the same scans without added marks", () => {
    const scans = [checkout];

    for (const mark of ["modified", "renamed", "removed"] as const) {
      expect(
        addedFromHead(
          scans,
          [{ id: "p/new.py", mark, box: "current" }],
          [headScan],
        ),
      ).toBe(scans);
    }

    expect(addedFromHead(scans, [], [headScan])).toBe(scans);
  });

  it("carries the head edges from the added module only", () => {
    const result = addedFromHead([checkout], added.slice(0, 1), [headScan]);
    const edges = result.flatMap((scan) => scan.edges);

    expect(edges).toEqual([{ from: "p/new.py", to: "p/a.py", kind: "import" }]);
  });
});
