import { describe, expect, it } from "vitest";
import { PolicyRule } from "../../src/index.js";
import { edge, repositoryWith } from "../fakes/dependency-of.js";

const forbid = (pattern: string, from: string, to: string): PolicyRule =>
  PolicyRule.of({
    type: "forbid",
    pattern,
    from: [from],
    to: [to],
  });

describe("Repository.violations", () => {
  it("groups two imports from one file under one rule into one violation", () => {
    const repository = repositoryWith(
      ["a/x.py", "b/y.py", "b/z.py"],
      [
        edge("a/x.py", "b/y.py", 3),
        edge("a/x.py", "b/y.py", 1),
        edge("a/x.py", "b/z.py", 7),
      ],
    );

    const found = repository.violations([
      forbid("a/** -> b/**", "a/**", "b/**"),
    ]);

    expect(found).toEqual([
      {
        file: "a/x.py",
        rule: { type: "forbid", pattern: "a/** -> b/**" },
        dependencies: [
          { to: "b/y.py", kind: "depends", lines: [1, 3] },
          { to: "b/z.py", kind: "depends", lines: [7] },
        ],
      },
    ]);
  });

  it("drops an edge touching an ignored file", () => {
    const repository = repositoryWith(
      ["a/x.py", "b/y.py"],
      [edge("a/x.py", "b/y.py")],
    );
    const rules: PolicyRule[] = [
      forbid("a/** -> b/**", "a/**", "b/**"),
      PolicyRule.of({ type: "ignore", glob: "b/**" }),
    ];

    expect(repository.dependencies).toHaveLength(1);
    expect(repository.violations(rules)).toEqual([]);
  });

  it("never flags a self-edge", () => {
    const repository = repositoryWith(["a/x.py"], [edge("a/x.py", "a/x.py")]);

    expect(repository.dependencies).toHaveLength(1);
    expect(repository.violations([forbid("** -> **", "**", "**")])).toEqual([]);
  });

  it("of three rules one matches, so one violation is returned and the other two rules name nothing", () => {
    const repository = repositoryWith(
      ["a/x.py", "b/y.py"],
      [edge("a/x.py", "b/y.py")],
    );

    const found = repository.violations([
      forbid("b/** -> a/**", "b/**", "a/**"),
      forbid("a/** -> b/**", "a/**", "b/**"),
      forbid("c/** -> a/**", "c/**", "a/**"),
    ]);

    expect(found).toHaveLength(1);
    expect(found[0]?.rule).toEqual({ type: "forbid", pattern: "a/** -> b/**" });
  });
});
