import { describe, expect, it } from "vitest";
import { Dependency, InvalidEntity, Library } from "../../src/index.js";

const make = (
  over: Partial<ConstructorParameters<typeof Dependency>[0]> = {},
) =>
  new Dependency({
    from: "a",
    to: "b",
    toLibrary: false,
    language: "python",
    kind: "depends",
    line: 1,
    ...over,
  });

describe("Dependency", () => {
  it("counts every kind but declares as an edge", () => {
    expect(make().countsAsEdge).toBe(true);
    expect(make({ kind: "inherits" }).countsAsEdge).toBe(true);
    expect(make({ kind: "declares" }).countsAsEdge).toBe(false);
  });

  it("refuses an empty from", () => {
    expect(() => make({ from: "" })).toThrow(InvalidEntity);
  });

  it("refuses an empty to", () => {
    expect(() => make({ to: "" })).toThrow(/to is empty/);
  });

  it("holds no optional key it was not given", () => {
    expect(Object.keys(make())).not.toContain("names");
    expect(make({ names: ["x"] }).names).toEqual(["x"]);
  });
});

describe("Library", () => {
  it("owns an id that starts foreign:", () => {
    expect(Library.owns("foreign:requests")).toBe(true);
    expect(Library.owns("src/foreign:x")).toBe(false);
  });
});
