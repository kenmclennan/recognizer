import { describe, expect, it } from "vitest";
import { Folder, InvalidEntity } from "../../src/index.js";

describe("Folder", () => {
  it("derive lists each ancestor directory once with its parent", () => {
    const folders = Folder.derive(["a/b/c.py", "a/b/d.py", "a/e.py", "f.py"]);

    expect(folders.map(({ path, parent }) => [path, parent])).toEqual([
      ["a/b", "a"],
      ["a", null],
    ]);
  });

  it("derive states which folders hold a file directly", () => {
    const folders = Folder.derive(["a/b/c.py", "g/h/i.py", "g/j.py"]);
    const holds = Object.fromEntries(folders.map((f) => [f.path, f.holdsFile]));

    expect(holds).toEqual({ "a/b": true, a: false, "g/h": true, g: true });
  });

  it("chainOf returns the ancestors outermost first", () => {
    expect(Folder.chainOf("a/b/c.py").map(({ path }) => path)).toEqual([
      "a",
      "a/b",
    ]);
    expect(Folder.chainOf("c.py")).toEqual([]);
  });

  it("containing names the folder holding a path, empty at the root", () => {
    expect(Folder.containing("a/b/c.py")).toBe("a/b");
    expect(Folder.containing("c.py")).toBe("");
  });

  it("accepts a path of one segment whose parent is null", () => {
    const folder = new Folder("a", null);

    expect(folder.name).toBe("a");
    expect(folder.parent).toBeNull();
  });

  it("names the last segment", () => {
    expect(new Folder("a/b", "a").name).toBe("b");
  });

  it("refuses an empty path", () => {
    expect(() => new Folder("", null)).toThrow(InvalidEntity);
  });

  it("refuses a leading or trailing slash", () => {
    expect(() => new Folder("/a", null)).toThrow(/"\/a"/);
    expect(() => new Folder("a/", null)).toThrow(/"a\/"/);
  });

  it("refuses a parent that is not the path minus its last segment", () => {
    expect(() => new Folder("a/b", "x")).toThrow(/"x"/);
    expect(() => new Folder("a/b", null)).toThrow(InvalidEntity);
  });
});
