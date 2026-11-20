import type { Scan } from "recognizer";
import { describe, expect, it } from "vitest";
import { unionScans } from "../../src/change-union";

const scan = (ids: string[], edges: [string, string][]): Scan => ({
  modules: ids.map((id) => ({ id, language: "python", kind: "module" })),
  edges: edges.map(([from, to], line) => ({
    from,
    to,
    kind: "depends",
    line: line + 1,
  })),
  foreign: [],
});

describe("unionScans", () => {
  const head = [scan(["p/a.py", "p/b.py"], [["p/a.py", "p/b.py"]])];
  const base = [
    scan(
      ["p/a.py", "p/b.py", "p/gone.py", "q/other.py"],
      [
        ["p/a.py", "p/b.py"],
        ["p/gone.py", "p/a.py"],
        ["p/gone.py", "q/other.py"],
      ],
    ),
  ];

  it("adds a removed base module in its folder with its edge to a surviving module", () => {
    const union = unionScans(head, base, ["p/gone.py"]);
    const ids = union.flatMap((one) => one.modules.map((m) => m.id));
    const edges = union.flatMap((one) =>
      one.edges.map((edge) => `${edge.from}>${edge.to}`),
    );

    expect(ids).toEqual(["p/a.py", "p/b.py", "p/gone.py"]);
    expect(edges).toEqual(["p/a.py>p/b.py", "p/gone.py>p/a.py"]);
  });

  it("omits an edge whose far end is in neither scan", () => {
    const union = unionScans(head, base, ["p/gone.py"]);

    expect(
      union.flatMap((one) => one.edges).some((e) => e.to === "q/other.py"),
    ).toBe(false);
  });

  it("returns the head scans unchanged without a base or removed ids", () => {
    expect(unionScans(head, null, ["p/gone.py"])).toBe(head);
    expect(unionScans(head, base, [])).toBe(head);
  });

  it("does not duplicate a module the head still has", () => {
    const union = unionScans(head, base, ["p/a.py"]);

    expect(union).toBe(head);
  });
});
