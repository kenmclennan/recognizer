import { Dependency, type DependencyFields } from "@recognizer/core";

import { describe, expect, it } from "vitest";
import { describeEdge, describeLine } from "../../src/edge-evidence";

const FIELDS = {
  from: "a.py",
  to: "b.py",
  toLibrary: false,
  language: "python",
  kind: "depends",
  line: 3,
} as const;

const base = new Dependency(FIELDS);

const edgeWith = (extra: Partial<DependencyFields>) =>
  new Dependency({ ...FIELDS, ...extra });

describe("hover text", () => {
  it("names the imported names, or the target when there are none", () => {
    expect(describeEdge(edgeWith({ names: ["Order", "new_order"] }))).toBe(
      "uses Order, new_order",
    );
    expect(describeEdge(base)).toBe("imports b.py");
  });

  it("reads implements and inherits from the members", () => {
    expect(
      describeEdge(
        edgeWith({
          kind: "implements",
          member: "SqliteStore",
          toMember: "Store",
        }),
      ),
    ).toBe("SqliteStore implements Store");
    expect(
      describeEdge(edgeWith({ kind: "inherits", member: "A", toMember: "B" })),
    ).toBe("A inherits B");
  });

  it("says what an inferred edge was inferred from", () => {
    expect(
      describeEdge(
        edgeWith({
          inferred: {
            parameter: "store",
            methods: ["add"],
            class: "Store",
            implementations: [],
          },
        }),
      ),
    ).toBe("inferred: store.add, Store");
  });

  it("counts a grouped line and lists the first three", () => {
    const edges = [1, 2, 3, 4].map((line) => edgeWith({ line }));

    expect(describeLine(edges)).toBe(
      "4 dependencies: imports b.py; imports b.py; imports b.py; ...",
    );
    expect(describeLine([base])).toBe("imports b.py");
  });
});
