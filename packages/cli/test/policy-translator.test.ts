import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePolicy } from "../src/adapters/filesystem/policy-translator.js";
import type { InputError } from "../src/errors.js";
import { REPO } from "./helpers.js";

function messages(text: string): string[] {
  try {
    parsePolicy(text);
  } catch (error) {
    return (error as InputError).messages;
  }

  throw new Error("expected a policy error");
}

function countsOf(path: string) {
  const rules = parsePolicy(readFileSync(join(REPO, path), "utf8"));

  return {
    total: rules.length,
    forbid: rules.filter((rule) => rule.type === "forbid").length,
    ignore: rules.filter((rule) => rule.type === "ignore").length,
    entry: rules.filter((rule) => rule.type === "entry").length,
  };
}

describe("policy translator YAML handling", () => {
  it("refuses text that is not YAML", () => {
    expect(messages("a: [")).toHaveLength(1);
    expect(messages("a: [")[0]).toMatch(/^policy is not valid YAML: /);
  });
});

describe("policy translator over real policies", () => {
  it("reads the hexagonal starter policy into 8 rules", () => {
    expect(countsOf("docs/policies/hexagonal.yaml")).toEqual({
      total: 8,
      forbid: 4,
      ignore: 2,
      entry: 2,
    });
  });

  it("reads the vertical slices starter policy into 5 rules", () => {
    expect(countsOf("docs/policies/vertical-slices.yaml")).toEqual({
      total: 5,
      forbid: 4,
      ignore: 1,
      entry: 0,
    });
  });

  it("reads the repository's own policy into 6 rules", () => {
    expect(countsOf(".recognizer/policy.yaml")).toEqual({
      total: 6,
      forbid: 5,
      ignore: 1,
      entry: 0,
    });
  });
});

describe("policy translator", () => {
  it("reads a string forbid and a list forbid into the same shape", () => {
    expect(
      parsePolicy(
        "forbid:\n  - a/** -> b/**\n  - from: [a/**, c/**]\n    to: b/**\n",
      ),
    ).toEqual([
      { type: "forbid", pattern: "a/** -> b/**", from: ["a/**"], to: ["b/**"] },
      {
        type: "forbid",
        pattern: "a/**, c/** -> b/**",
        from: ["a/**", "c/**"],
        to: ["b/**"],
      },
    ]);
  });

  it("emits forbid, then ignore, then entry, each in document order", () => {
    const rules = parsePolicy(
      "entry: [e1, e2]\nignore: [i1, i2]\nforbid:\n  - a -> b\n  - c -> d\n",
    );

    expect(rules.map((rule) => rule.type)).toEqual([
      "forbid",
      "forbid",
      "ignore",
      "ignore",
      "entry",
      "entry",
    ]);
    expect(rules).toEqual([
      { type: "forbid", pattern: "a -> b", from: ["a"], to: ["b"] },
      { type: "forbid", pattern: "c -> d", from: ["c"], to: ["d"] },
      { type: "ignore", glob: "i1" },
      { type: "ignore", glob: "i2" },
      { type: "entry", glob: "e1" },
      { type: "entry", glob: "e2" },
    ]);
  });

  it("refuses what it refused before", () => {
    expect(messages("components: {}\nbogus: 1\n")).toEqual([
      'policy: "components" is retired; run recognizer doctor for the migration',
      'policy: unknown key "bogus"',
    ]);
    expect(messages("entry: src/main.ts\n")).toEqual([
      "entry: must be a list of globs",
    ]);
    expect(messages("ignore: x\nforbid: y\n")).toEqual([
      "forbid: must be a list",
      "ignore: must be a list of globs",
    ]);
    expect(messages("forbid:\n  - nothing\n")).toEqual([
      'forbid: "nothing" must look like "<from-glob> -> <to-glob>"',
    ]);
    expect(messages("- a\n")).toEqual(["policy must be a YAML mapping"]);
  });

  it("an empty ignore list and an empty entry list give no rules", () => {
    expect(parsePolicy("ignore: []\nentry: []\n")).toEqual([]);
  });
});
