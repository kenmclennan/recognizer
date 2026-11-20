import { describe, expect, it } from "vitest";
import { bruteForcePairs, prunedPairs } from "../src/duplication/score.js";

function seeded(seed: number): () => number {
  let state = seed;

  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;

    return state / 4294967296;
  };
}

function randomSets(random: () => number, count: number, alphabet: number) {
  return Array.from({ length: count }, () => {
    const size = 1 + Math.floor(random() * 12);

    return new Set(
      Array.from({ length: size }, () => `f${Math.floor(random() * alphabet)}`),
    );
  });
}

describe("prunedPairs", () => {
  for (const threshold of [0.3, 0.5, 0.82, 1]) {
    it(`finds exactly the pairs a brute-force comparison finds at ${threshold}`, () => {
      const random = seeded(7);

      for (let round = 0; round < 40; round += 1) {
        const sets = randomSets(random, 25, 14);
        const pruned = prunedPairs(sets, threshold);

        expect(pruned).toEqual(bruteForcePairs(sets, threshold));
      }
    });
  }

  it("keeps a pair whose ratio equals the threshold exactly", () => {
    const sets = [new Set(["a", "b"]), new Set(["a", "b", "c", "d"])];

    expect(prunedPairs(sets, 0.5)).toEqual([[0, 1, 2, 4]]);
    expect(prunedPairs(sets, 0.51)).toEqual([]);
  });

  it("orders pairs by their positions and names the lower position first", () => {
    const sets = [
      new Set(["a", "b", "c", "d"]),
      new Set(["a", "b"]),
      new Set(["a", "b", "c"]),
    ];

    expect(prunedPairs(sets, 0.4).map(([i, j]) => [i, j])).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
    ]);
  });
});
