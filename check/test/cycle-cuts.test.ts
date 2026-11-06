import { describe, expect, it } from "vitest";

import { strongComponents } from "../src/analyse.js";
import { cutSet, splitCandidates } from "../src/cycle-cuts.js";
import { folderOf } from "../src/structure-warnings.js";

function imports(pairs: [string, string][]) {
  return pairs.map(([from, to]) => ({ from, to }));
}

function cutOf(pairs: [string, string][]) {
  return cutSet(folderOf, imports(pairs)).map(
    (cut) => `${cut.from} -> ${cut.to}`,
  );
}

function remainderIsAcyclic(
  pairs: [string, string][],
  cut: { from: string; to: string }[],
): boolean {
  const removed = new Set(cut.map((edge) => `${edge.from}\0${edge.to}`));
  const successors = new Map<string, string[]>();

  for (const [from, to] of pairs) {
    const source = folderOf(from);
    const target = folderOf(to);

    if (!successors.has(target)) {
      successors.set(target, []);
    }

    if (removed.has(`${from}\0${to}`) || source === target) {
      successors.set(source, successors.get(source) ?? []);

      continue;
    }

    successors.set(source, [...(successors.get(source) ?? []), target]);
  }

  return strongComponents([...successors.keys()].sort(), successors).every(
    (component) => component.length < 2,
  );
}

const STAR: [string, string][] = [
  ["a/x", "h/x"],
  ["b/x", "h/x"],
  ["h/x", "a/y"],
  ["h/y", "b/y"],
];

describe("cutSet", () => {
  it("cuts the lighter direction", () => {
    expect(
      cutOf([
        ["a/x", "b/p"],
        ["a/y", "b/p"],
        ["a/z", "b/q"],
        ["b/p", "a/x"],
      ]),
    ).toEqual(["b/p -> a/x"]);
  });

  it("breaks a tie towards the order built from code-unit order", () => {
    expect(
      cutOf([
        ["a/x", "b/p"],
        ["b/p", "a/x"],
      ]),
    ).toEqual(["b/p -> a/x"]);
  });

  it("cuts the lightest edge of a ring", () => {
    expect(
      cutOf([
        ["ra/x", "rb/x"],
        ["ra/y", "rb/x"],
        ["rb/x", "rc/x"],
        ["rc/x", "ra/x"],
        ["rc/y", "ra/x"],
        ["rc/z", "ra/y"],
      ]),
    ).toEqual(["rb/x -> rc/x"]);
  });

  it("ranks two cut edges of equal weight by source folder", () => {
    expect(cutOf(STAR)).toEqual(["h/x -> a/y", "h/y -> b/y"]);
  });

  it("lists a one-import cut before a two-import cut", () => {
    const pairs: [string, string][] = [
      ["a/x", "b/x"],
      ["a/y", "b/x"],
      ["a/z", "b/x"],
      ["b/x", "c/x"],
      ["b/y", "c/x"],
      ["b/z", "c/x"],
      ["c/x", "a/x"],
      ["c/y", "a/y"],
      ["c/z", "d/x"],
      ["d/x", "c/x"],
    ];
    const cut = cutOf(pairs);

    expect(cut).toEqual(["d/x -> c/x", "c/x -> a/x", "c/y -> a/y"]);
  });

  it("leaves no cycle and no restorable import", () => {
    const pairs: [string, string][] = [
      ["a/x", "b/x"],
      ["b/x", "c/x"],
      ["c/x", "a/x"],
      ["c/y", "b/y"],
      ["b/y", "a/y"],
      ["a/y", "c/y"],
      ["a/z", "c/z"],
    ];
    const cut = cutSet(folderOf, imports(pairs));

    expect(remainderIsAcyclic(pairs, cut)).toBe(true);

    for (const restored of cut) {
      expect(
        remainderIsAcyclic(
          pairs,
          cut.filter((other) => other !== restored),
        ),
      ).toBe(false);
    }
  });

  it("gives the same cut for a shuffled input", () => {
    const shuffled = [...STAR].reverse();

    expect(cutSet(folderOf, imports(shuffled))).toEqual(
      cutSet(folderOf, imports(STAR)),
    );
  });
});

describe("splitCandidates", () => {
  const edges = STAR.map(([from, to]) => ({
    from: folderOf(from),
    to: folderOf(to),
  }));

  it("names a folder exactly on the threshold", () => {
    expect(splitCandidates(edges, 2)).toEqual(["h"]);
  });

  it("names none just over the threshold", () => {
    expect(splitCandidates(edges, 3)).toEqual([]);
  });

  it("does not name a folder imported by many that imports few", () => {
    const mixed = [
      { from: "a", to: "h" },
      { from: "b", to: "h" },
      { from: "c", to: "h" },
      { from: "h", to: "a" },
    ];

    expect(splitCandidates(mixed, 2)).toEqual([]);
  });
});
