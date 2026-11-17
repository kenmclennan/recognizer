import { describe, expect, it } from "vitest";
import { type InputError, parsePolicy } from "../src/index.js";

function messages(text: string): string[] {
  try {
    parsePolicy(text);
  } catch (error) {
    return (error as InputError).messages;
  }

  throw new Error("expected a policy error");
}

describe("parsePolicy forbid entries", () => {
  it("reads a string rule and a list rule", () => {
    const policy = parsePolicy(
      "forbid:\n  - a/** -> b/**\n  - from: [c/**, d/**]\n    to: [e/**, f/**]\n",
    );

    expect(policy.forbid.map((rule) => rule.pattern)).toEqual([
      "a/** -> b/**",
      "c/**, d/** -> e/**, f/**",
    ]);
    expect(policy.forbid[1]?.from("d/x")).toBe(true);
    expect(policy.forbid[1]?.from("e/x")).toBe(false);
    expect(policy.forbid[1]?.to("f/x")).toBe(true);
    expect(policy.forbid[1]?.to("c/x")).toBe(false);
  });

  it("reads a single glob for from and to", () => {
    const policy = parsePolicy("forbid:\n  - from: a/**\n    to: b/**\n");

    expect(policy.forbid[0]?.pattern).toBe("a/** -> b/**");
  });

  it.each([
    ["a third key", "forbid:\n  - from: a/**\n    to: b/**\n    why: x\n"],
    ["a missing to", "forbid:\n  - from: a/**\n"],
    ["a missing from", "forbid:\n  - to: a/**\n"],
    ["an empty from list", "forbid:\n  - from: []\n    to: b/**\n"],
    ["an empty to list", "forbid:\n  - from: a/**\n    to: []\n"],
    ["an empty glob string", 'forbid:\n  - from: [""]\n    to: b/**\n'],
    ["a number in a list", "forbid:\n  - from: [1]\n    to: b/**\n"],
  ])("rejects a mapping with %s, naming the entry", (_name, text) => {
    const found = messages(text);

    expect(found.length).toBeGreaterThan(0);
    expect(found[0]).toMatch(/^forbid/);
  });
});

describe("parsePolicy entry", () => {
  it("accepts a list of globs", () => {
    const policy = parsePolicy("entry: [src/main.ts, 'src/jobs/**']\n");

    expect(policy.entryGlobs).toEqual(["src/main.ts", "src/jobs/**"]);
    expect(policy.entry.some((matches) => matches("src/main.ts"))).toBe(true);
    expect(policy.entry.some((matches) => matches("src/jobs/a/b.ts"))).toBe(
      true,
    );
    expect(policy.entry.some((matches) => matches("src/other.ts"))).toBe(false);
  });

  it("rejects a non-list", () => {
    expect(messages("entry: src/main.ts\n")).toEqual([
      "entry: must be a list of globs",
    ]);
  });
});

describe("parsePolicy retired keys", () => {
  it.each(["components", "levels", "uses"])("rejects %s", (key) => {
    expect(messages(`${key}: {}\n`)).toEqual([
      `policy: "${key}" is retired; run recognizer doctor for the migration`,
    ]);
  });

  it("gives one message per retired key", () => {
    expect(messages("components: {}\nlevels: []\nuses: {}\n")).toEqual([
      'policy: "components" is retired; run recognizer doctor for the migration',
      'policy: "levels" is retired; run recognizer doctor for the migration',
      'policy: "uses" is retired; run recognizer doctor for the migration',
    ]);
  });
});
