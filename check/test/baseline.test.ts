import { describe, expect, it } from "vitest";
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
});
