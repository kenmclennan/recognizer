import { describe, expect, it } from "vitest";
import { documentFreshness } from "../../src/index.js";
import { repositoryOf } from "../fakes/repository-of.js";

const SCAN = repositoryOf({ "a.py": "ha", "b.py": "hb", "c.py": "hc" }, [
  "a.py",
  "b.py",
  "c.py",
]);

describe("documentFreshness", () => {
  it("lists every scanned file the document measured at its current hash", () => {
    const measured = { inputs: { "a.py": "ha", "b.py": "old" }, tests: "t1" };

    expect(documentFreshness(SCAN, measured, "t1")).toEqual({
      valid: true,
      current: ["a.py"],
      recorded: ["a.py", "b.py"],
      outOfDate: 1,
      stale: true,
    });
  });

  it("is invalid and lists no file current when the document has no inputs", () => {
    expect(documentFreshness(SCAN, {}, "t1")).toEqual({
      valid: false,
      current: [],
      recorded: [],
      outOfDate: 0,
      stale: true,
    });
  });

  it("is invalid when the tests digest differs from the one asked about", () => {
    const measured = { inputs: { "a.py": "ha" }, tests: "other" };

    expect(documentFreshness(SCAN, measured, "t1")).toMatchObject({
      valid: false,
      current: [],
    });
  });

  it("calls a document with no tests digest valid against any digest", () => {
    const measured = { inputs: { "a.py": "ha" } };

    expect(documentFreshness(SCAN, measured, null)).toMatchObject({
      valid: true,
      current: ["a.py"],
    });
  });

  it("stale is false when the document is valid and nothing is out of date", () => {
    const measured = { inputs: { "a.py": "ha", "b.py": "hb" }, tests: "t1" };

    expect(documentFreshness(SCAN, measured, "t1")).toMatchObject({
      valid: true,
      outOfDate: 0,
      stale: false,
    });
  });

  it("stale is true when valid and one file is out of date", () => {
    const measured = { inputs: { "a.py": "ha", "b.py": "old" }, tests: "t1" };

    expect(documentFreshness(SCAN, measured, "t1")).toMatchObject({
      valid: true,
      outOfDate: 1,
      stale: true,
    });
  });

  it("stale is true when invalid with nothing out of date", () => {
    expect(documentFreshness(SCAN, {}, "t1")).toMatchObject({
      valid: false,
      outOfDate: 0,
      stale: true,
    });
  });
});
