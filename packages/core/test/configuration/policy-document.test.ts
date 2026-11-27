import { describe, expect, it } from "vitest";
import {
  isRetiredPolicyKeyMessage,
  POLICY_KEYS,
  type PolicyRule,
  policyNotYamlMessage,
  readPolicyDocument,
  retiredPolicyKeyMessage,
} from "../../src/index.js";

function messagesOf(document: unknown): string[] {
  const read = readPolicyDocument(document);

  if (read.ok) {
    throw new Error("expected a refusal");
  }

  return read.messages;
}

function rulesOf(document: unknown): PolicyRule[] {
  const read = readPolicyDocument(document);

  if (!read.ok) {
    throw new Error(read.messages.join("; "));
  }

  return read.rules;
}

describe("readPolicyDocument", () => {
  it("emits forbid, then ignore, then entry whatever the key order", () => {
    const rules = rulesOf({
      entry: ["src/main.ts"],
      ignore: ["dist/**"],
      forbid: ["a/** -> b/**", { from: ["c/**", "d/**"], to: "e/**" }],
    });

    expect(rules.map((rule) => rule.type)).toEqual([
      "forbid",
      "forbid",
      "ignore",
      "entry",
    ]);
    expect(rules[0]?.pattern).toBe("a/** -> b/**");
    expect(rules[1]?.pattern).toBe("c/**, d/** -> e/**");
  });

  it.each([null, [], "text", 3])("refuses %j as not a mapping", (document) => {
    expect(messagesOf(document)).toEqual(["policy must be a YAML mapping"]);
  });

  it("names a retired key and an unknown key", () => {
    expect(messagesOf({ levels: [], bogus: 1 })).toEqual([
      'policy: "levels" is retired; run recognizer doctor for the migration',
      'policy: unknown key "bogus"',
    ]);
  });

  it("collects every message in document key order, then forbid, ignore, entry", () => {
    expect(messagesOf({ components: {}, bogus: 1, entry: "x" })).toEqual([
      'policy: "components" is retired; run recognizer doctor for the migration',
      'policy: unknown key "bogus"',
      "entry: must be a list of globs",
    ]);

    expect(messagesOf({ ignore: "x", forbid: "y" })).toEqual([
      "forbid: must be a list",
      "ignore: must be a list of globs",
    ]);
  });

  it("words each structural problem", () => {
    expect(messagesOf({ ignore: [""] })).toEqual([
      "ignore: every glob must be a non-empty string",
    ]);
    expect(messagesOf({ entry: [3] })).toEqual([
      "entry: every glob must be a non-empty string",
    ]);
    expect(messagesOf({ forbid: [3] })).toEqual([
      "forbid: every entry must be a string or a from/to mapping",
    ]);
    expect(messagesOf({ forbid: ["a/**"] })).toEqual([
      'forbid: "a/**" must look like "<from-glob> -> <to-glob>"',
    ]);
    expect(messagesOf({ forbid: [" -> b/**"] })).toEqual([
      'forbid: " -> b/**" has an empty glob',
    ]);
    expect(messagesOf({ forbid: [{ from: "a" }] })).toEqual([
      'forbid: {"from":"a"} must have exactly the keys "from" and "to"',
    ]);
    expect(messagesOf({ forbid: [{ from: [], to: "b" }] })).toEqual([
      'forbid: {"from":[],"to":"b"} has an empty "from" list',
    ]);
    expect(messagesOf({ forbid: [{ from: "a", to: [] }] })).toEqual([
      'forbid: {"from":"a","to":[]} has an empty "to" list',
    ]);
    expect(messagesOf({ forbid: [{ from: ["a", ""], to: "b" }] })).toEqual([
      'forbid {"from":["a",""],"to":"b"} from: every glob must be a non-empty string',
    ]);
  });

  it("refuses a forbid list holding one valid and one invalid entry", () => {
    expect(messagesOf({ forbid: ["a/** -> b/**", "broken"] })).toEqual([
      'forbid: "broken" must look like "<from-glob> -> <to-glob>"',
    ]);
  });

  it("allows exactly the published policy keys", () => {
    const published = POLICY_KEYS.keys.map((key) => key.key);

    for (const key of published) {
      expect(readPolicyDocument({ [key]: undefined }).ok).toBe(true);
    }

    expect(published.slice().sort()).toEqual(["entry", "forbid", "ignore"]);
    expect(messagesOf({ bogus: undefined })).toEqual([
      'policy: unknown key "bogus"',
    ]);
  });
});

describe("policy wording", () => {
  it("words a retired key", () => {
    expect(retiredPolicyKeyMessage("levels")).toBe(
      'policy: "levels" is retired; run recognizer doctor for the migration',
    );
  });

  it("words invalid YAML", () => {
    expect(policyNotYamlMessage("oops")).toBe("policy is not valid YAML: oops");
  });

  it("recognises exactly the four retired lines", () => {
    for (const key of ["components", "levels", "uses", "foreign"]) {
      expect(isRetiredPolicyKeyMessage(retiredPolicyKeyMessage(key))).toBe(
        true,
      );
    }

    expect(isRetiredPolicyKeyMessage('policy: unknown key "levels"')).toBe(
      false,
    );
    expect(isRetiredPolicyKeyMessage(retiredPolicyKeyMessage("bogus"))).toBe(
      false,
    );
  });
});
