import { describe, expect, it } from "vitest";
import { identityOfViolationId, violationId } from "../src/baseline.js";
import { InputError, parseBaseline, serialiseBaseline } from "../src/index.js";

const entry = (from: string, to: string, kind = "depends") => ({
  from,
  to,
  kind,
});
const doc = (violations: object[], version = 1) =>
  JSON.stringify({ schema_version: version, violations });

describe("baseline", () => {
  it("round trips byte-identically", () => {
    const text = serialiseBaseline([entry("b", "a"), entry("a", "z")]);

    expect(serialiseBaseline(parseBaseline(text))).toBe(text);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("rejects unsorted entries", () => {
    expect(() =>
      parseBaseline(doc([entry("b", "a"), entry("a", "b")])),
    ).toThrow(InputError);
  });

  it("rejects duplicate entries", () => {
    expect(() =>
      parseBaseline(doc([entry("a", "b"), entry("a", "b")])),
    ).toThrow(InputError);
  });

  it("rejects an unknown schema_version", () => {
    expect(() => parseBaseline(doc([], 2))).toThrow(InputError);
  });

  it("rejects entries with extra keys", () => {
    expect(() => parseBaseline(doc([{ ...entry("a", "b"), line: 3 }]))).toThrow(
      InputError,
    );
  });

  it("accepts id entries after identity entries and round trips them", () => {
    const text = serialiseBaseline([
      { id: "z:1" },
      entry("a", "b"),
      { id: "a:1" },
    ]);

    expect(parseBaseline(text)).toEqual([
      entry("a", "b"),
      { id: "a:1" },
      { id: "z:1" },
    ]);
    expect(serialiseBaseline(parseBaseline(text))).toBe(text);
  });

  it("rejects an id entry before an identity entry", () => {
    expect(() => parseBaseline(doc([{ id: "a:1" }, entry("a", "b")]))).toThrow(
      InputError,
    );
  });

  it("rejects an id entry holding another key", () => {
    expect(() => parseBaseline(doc([{ id: "a:1", from: "a" }]))).toThrow(
      InputError,
    );
  });

  it("rejects an id entry that repeats an identity entry", () => {
    expect(() =>
      parseBaseline(
        doc([entry("a", "b"), { id: violationId(entry("a", "b")) }]),
      ),
    ).toThrow(InputError);
  });

  it("maps a violation id back to its identity", () => {
    const identity = entry("a/b.py", "c/d.py", "inherits");

    expect(identityOfViolationId(violationId(identity))).toEqual(identity);
    expect(identityOfViolationId("hub:a")).toBeNull();
  });
});
