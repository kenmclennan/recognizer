import { describe, expect, it } from "vitest";
import { findingFor, type Unit } from "../src/duplication/findings.js";
import { roundPercent, roundSimilarity } from "../src/duplication/score.js";
import { compareCodePoints } from "../src/duplication/syntax.js";

function unit(identity: string, module = "m"): Unit {
  return {
    module,
    file: module,
    qualified: identity,
    startLine: 1,
    endLine: 8,
    startIndex: 0,
    endIndex: 10,
    fingerprints: new Set(),
    identity,
  };
}

describe("rounding and ordering as Python does them", () => {
  it("rounds a three-place tie to even and the percentage of 13 over 16 to 81", () => {
    expect(roundSimilarity(13 / 16)).toBe(0.812);
    expect(roundPercent(13 / 16)).toBe(81);
  });

  it("rounds the percentage of 33 over 40 to 82", () => {
    expect(roundPercent(33 / 40)).toBe(82);
  });

  it("writes both figures into a finding", () => {
    const finding = findingFor([unit("a"), unit("b")], 13 / 16);

    expect(finding.evidence.measures).toEqual({ similarity: 0.812 });
    expect(finding.summary).toContain("is 81% similar to");
  });

  it("orders identities that differ only by an astral code point by code point", () => {
    const astral = "\u{1F600}";
    const bmp = "\uFFFD";

    expect(compareCodePoints(`x${astral}`, `x${bmp}`)).toBe(1);
    expect(`x${astral}` < `x${bmp}`).toBe(true);

    const finding = findingFor([unit(`x${astral}`), unit(`x${bmp}`)], 0.9);

    expect(finding.id).toBe(`duplication:x${bmp}|x${astral}`);
  });
});
