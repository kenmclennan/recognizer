import { describe, expect, it } from "vitest";
import { Dependency, File, Repository, unionScans } from "../../src/index.js";

const file = (path: string) =>
  new File({
    path,
    language: "python",
    kind: "source",
    hash: null,
    members: [],
    entryPoint: false,
    annotations: [],
    actualOf: [],
  });

const scan = (ids: string[], edges: [string, string][]) =>
  Repository.of({
    files: ids.map(file),
    dependencies: edges.map(
      ([from, to], line) =>
        new Dependency({
          from,
          to,
          toLibrary: false,
          language: "python",
          kind: "depends",
          line: line + 1,
        }),
    ),
  });

describe("unionScans", () => {
  const head = scan(["p/a.py", "p/b.py"], [["p/a.py", "p/b.py"]]);
  const base = scan(
    ["p/a.py", "p/b.py", "p/gone.py", "q/other.py"],
    [
      ["p/a.py", "p/b.py"],
      ["p/gone.py", "p/a.py"],
      ["p/gone.py", "q/other.py"],
    ],
  );

  it("adds a removed base module with its edge to a surviving module", () => {
    const union = unionScans(head, base, ["p/gone.py"]);
    const ids = union.files.map((one) => one.path);
    const edges = union.dependencies.map((edge) => `${edge.from}>${edge.to}`);

    expect(ids.length).toBeGreaterThan(head.files.length);
    expect(ids).toEqual(["p/a.py", "p/b.py", "p/gone.py"]);
    expect(edges).toEqual(["p/a.py>p/b.py", "p/gone.py>p/a.py"]);
  });

  it("omits an edge whose far end is in neither scan", () => {
    const union = unionScans(head, base, ["p/gone.py"]);

    expect(union.files.length).toBeGreaterThan(head.files.length);
    expect(union.dependencies.some((edge) => edge.to === "q/other.py")).toBe(
      false,
    );
  });

  it("returns the head unchanged without a base or removed ids", () => {
    expect(unionScans(head, null, ["p/gone.py"])).toBe(head);
    expect(unionScans(head, base, [])).toBe(head);
  });

  it("does not duplicate a module the head still has", () => {
    expect(unionScans(head, base, ["p/a.py"])).toBe(head);
  });

  it("adds the removed id that resolves in the base and drops the one that does not", () => {
    const union = unionScans(head, base, ["p/gone.py", "nowhere.py"]);

    expect(union.files.length).toBeGreaterThan(head.files.length);
    expect(union.files.map((one) => one.path)).toEqual([
      "p/a.py",
      "p/b.py",
      "p/gone.py",
    ]);
  });
});
