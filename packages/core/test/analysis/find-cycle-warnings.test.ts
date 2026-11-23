import { describe, expect, it } from "vitest";
import { findCycleWarnings } from "../../src/index.js";
import { edge, repositoryWith } from "../fakes/dependency-of.js";

describe("findCycleWarnings", () => {
  it("gives one warning for a two-file cycle with files sorted", () => {
    const repository = repositoryWith(
      ["b.py", "a.py"],
      [edge("b.py", "a.py"), edge("a.py", "b.py")],
    );

    expect(findCycleWarnings(repository, [])).toEqual([
      {
        kind: "cycle",
        principle: "levelization",
        fixPattern: "break-cycle",
        summary: "cycle of 2 files: a.py, b.py",
        files: ["a.py", "b.py"],
        dependencies: [
          { from: "a.py", to: "b.py" },
          { from: "b.py", to: "a.py" },
        ],
      },
    ]);
  });

  it("gives none for an acyclic graph", () => {
    const repository = repositoryWith(
      ["a.py", "b.py", "c.py"],
      [edge("a.py", "b.py"), edge("b.py", "c.py")],
    );

    expect(repository.files).toHaveLength(3);
    expect(findCycleWarnings(repository, [])).toEqual([]);
  });

  it("does not count a sealed type with its subtypes as a cycle", () => {
    const base = repositoryWith(
      ["Shape.kt", "Circle.kt"],
      [
        { ...edge("Circle.kt", "Shape.kt", 1, "inherits"), toMember: "Shape" },
        edge("Shape.kt", "Circle.kt"),
      ],
    );
    const repository = {
      ...base,
      files: base.files.map((file) =>
        file.path === "Shape.kt"
          ? {
              ...file,
              members: [
                {
                  name: "Shape",
                  exported: true,
                  kind: "class" as const,
                  tags: ["sealed"],
                },
              ],
            }
          : file,
      ),
    };

    expect(repository.files).toHaveLength(2);
    expect(findCycleWarnings(repository, [])).toEqual([]);
  });
});
