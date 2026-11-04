import type { ScanEdge } from "recognizer";
import { describe, expect, it } from "vitest";
import { describeEdge, describeLine } from "./edge-evidence";

const base: ScanEdge = { from: "a.py", to: "b.py", kind: "depends", line: 3 };

describe("hover text", () => {
  it("names the imported names, or the target when there are none", () => {
    expect(describeEdge({ ...base, names: ["Order", "new_order"] })).toBe(
      "uses Order, new_order",
    );
    expect(describeEdge(base)).toBe("imports b.py");
  });

  it("reads implements and inherits from the members", () => {
    expect(
      describeEdge({
        ...base,
        kind: "implements",
        member: "SqliteStore",
        to_member: "Store",
      }),
    ).toBe("SqliteStore implements Store");
    expect(
      describeEdge({ ...base, kind: "inherits", member: "A", to_member: "B" }),
    ).toBe("A inherits B");
  });

  it("says what an inferred edge was inferred from", () => {
    expect(
      describeEdge({
        ...base,
        inferred: {
          parameter: "store",
          methods: ["add"],
          class: "Store",
          implementations: [],
        },
      }),
    ).toBe("inferred: store.add, Store");
  });

  it("counts a grouped line and lists the first three", () => {
    const edges = [1, 2, 3, 4].map((line) => ({ ...base, line }));

    expect(describeLine(edges)).toBe(
      "4 dependencies: imports b.py; imports b.py; imports b.py; ...",
    );
    expect(describeLine([base])).toBe("imports b.py");
  });
});
