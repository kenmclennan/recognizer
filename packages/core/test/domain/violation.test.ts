import { describe, expect, it } from "vitest";
import { InvalidEntity, Violation, Warning } from "../../src/index.js";

const rule = { type: "forbid", pattern: "p" } as const;
const dependency = (to: string, lines: number[]) => ({
  to,
  kind: "depends",
  lines,
});

describe("Violation", () => {
  it("narrowedTo keeps the dependency order and passes each index", () => {
    const violation = new Violation({
      file: "a",
      rule,
      dependencies: [
        dependency("x", [1]),
        dependency("y", [2]),
        dependency("z", [3]),
      ],
    });
    const seen: number[] = [];
    const narrowed = violation.narrowedTo((_, index) => {
      seen.push(index);

      return index !== 1;
    });

    expect(seen).toEqual([0, 1, 2]);
    expect(narrowed.dependencies.map(({ to }) => to)).toEqual(["x", "z"]);
    expect(violation.dependencies).toHaveLength(3);
  });

  it("refuses a violation without a dependency", () => {
    expect(() => new Violation({ file: "a", rule, dependencies: [] })).toThrow(
      InvalidEntity,
    );
  });

  it("accepts one dependency", () => {
    expect(
      new Violation({ file: "a", rule, dependencies: [dependency("x", [1])] })
        .file,
    ).toBe("a");
  });

  it("refuses lines that are not sorted and de-duplicated", () => {
    expect(
      () =>
        new Violation({
          file: "a",
          rule,
          dependencies: [dependency("x", [3, 1])],
        }),
    ).toThrow(/3,1/);
    expect(
      () =>
        new Violation({
          file: "a",
          rule,
          dependencies: [dependency("x", [1, 1])],
        }),
    ).toThrow(InvalidEntity);
  });
});

describe("Warning", () => {
  it("refuses a warning without a file", () => {
    expect(
      () => new Warning({ summary: "s", files: [], dependencies: [] }),
    ).toThrow(InvalidEntity);
  });

  it("accepts one file", () => {
    expect(
      new Warning({ summary: "s", files: ["a"], dependencies: [] }).kind,
    ).toBe("cycle");
  });
});
