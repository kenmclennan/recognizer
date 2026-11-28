import { describe, expect, it } from "vitest";
import {
  CORE_KEYS,
  descentRefusal,
  dropsEmptyHolder,
  forbidRuleRemoval,
  forbidRuleText,
  keyIsSectionRefusal,
  notAListRefusal,
  notASectionRefusal,
  occupantRefusal,
  parseKeyPath,
  publish,
  resolveKey,
  resolveSection,
  retiredUnsetDecision,
  retiredWriteRefusal,
  sectionUnsetRefusal,
  splitKeyPath,
  stepsFor,
  switchesToMap,
  unreachableRefusal,
  valueCountRefusal,
} from "../../src/index.js";

const published = publish([CORE_KEYS], "config");
const RETIRED = "sensors.structure.hub_threshold";

describe("key paths", () => {
  it("refuses a key path with an empty segment", () => {
    expect(parseKeyPath("a..b", "key")).toEqual({
      reason: "a key is dotted names with none empty",
    });
  });

  it("refuses the empty string as a key path", () => {
    expect(parseKeyPath("", "key")).toEqual({
      reason: "a key is dotted names with none empty",
    });
  });

  it("refuses a section path with an empty segment", () => {
    expect(parseKeyPath("a..b", "section")).toEqual({
      reason: "a section is dotted names with none empty",
    });
  });

  it("accepts a path with no empty segment", () => {
    expect(parseKeyPath("a", "key")).toEqual({ path: ["a"] });
  });

  it("splits without refusing an empty segment", () => {
    expect(splitKeyPath("a..b")).toEqual(["a", "", "b"]);
  });
});

describe("resolving a key or section", () => {
  it("finds a published key", () => {
    expect(
      "found" in resolveKey(published, ["sensors", "structure", "enabled"]),
    ).toBe(false);
  });

  it("flags a path that names a section as a section, not a key", () => {
    const resolved = resolveKey(published, ["sensors", "mine"]);

    expect(resolved).toEqual({
      reason: "sensors.mine is a section, not a key",
      isSection: true,
    });
  });

  it("does not flag an unknown path as a section", () => {
    const resolved = resolveKey(published, ["nonsense"]);

    expect("isSection" in resolved && resolved.isSection).toBe(false);
  });

  it("refuses a key given where a section is wanted", () => {
    const typed = ["sensors", "structure", "duplication", "threshold"];
    const resolved = resolveSection(published, typed.join("."), typed);

    expect(resolved).toEqual({
      reason: `${typed.join(".")} is a key, not a section; remove it with --unset`,
    });
  });

  it("states the key-is-section text", () => {
    expect(keyIsSectionRefusal("a.b")).toBe("a.b is a section, not a key");
  });
});

describe("retired keys", () => {
  it("refuses a write to a retired key that resolves", () => {
    expect(retiredWriteRefusal(RETIRED, true)).toContain("was removed");
  });

  it("refuses a write beneath a retired path", () => {
    expect(retiredWriteRefusal(`${RETIRED}.x`, false)).toContain("was removed");
  });

  it("does not refuse the exact retired path when it does not resolve", () => {
    expect(retiredWriteRefusal(RETIRED, true)).not.toBeNull();
    expect(retiredWriteRefusal(RETIRED, false)).toBeNull();
  });

  it("does not refuse a key that is not retired", () => {
    expect(retiredWriteRefusal("nonsense", true)).toBeNull();
  });

  it("unsets the exact retired path with no value", () => {
    expect(retiredUnsetDecision(RETIRED, undefined)).toEqual({
      kind: "unset-retired",
      path: ["sensors", "structure", "hub_threshold"],
    });
  });

  it("refuses the exact retired path with a value", () => {
    const decision = retiredUnsetDecision(RETIRED, "3");

    expect(decision.kind).toBe("refused");
  });

  it("refuses a path beneath a retired path", () => {
    expect(retiredUnsetDecision(`${RETIRED}.x`, undefined).kind).toBe(
      "refused",
    );
  });

  it("decides nothing for a key that is not retired", () => {
    expect(retiredUnsetDecision("nonsense", undefined)).toEqual({
      kind: "none",
    });
  });
});

describe("value counts", () => {
  it("refuses a set on a multi key", () => {
    expect(valueCountRefusal("set", "k", true)).toBe(
      "k holds a list; add an item with --add",
    );
    expect(valueCountRefusal("set", "k", false)).toBeNull();
  });

  it("refuses an add on a single key", () => {
    expect(valueCountRefusal("add", "k", false)).toBe(
      "k holds one value; set it without --add",
    );
    expect(valueCountRefusal("add", "k", true)).toBeNull();
  });

  it("refuses an unset with a value on a single key", () => {
    expect(valueCountRefusal("unset", "k", false)).toBe(
      "k holds one value; unset it without a value",
    );
    expect(valueCountRefusal("unset", "k", true)).toBeNull();
  });
});

describe("what already occupies a key", () => {
  it("names --remove-section when a section is there", () => {
    expect(occupantRefusal("k", "section", false)).toBe(
      "k is a section; remove it with --remove-section first",
    );
  });

  it("names --unset when a list is there", () => {
    expect(occupantRefusal("k", "list", false)).toBe(
      "k is a list; remove it with --unset first",
    );
  });

  it("allows an empty or scalar occupant and a switch to a map", () => {
    expect(occupantRefusal("k", "empty", false)).toBeNull();
    expect(occupantRefusal("k", "scalar", false)).toBeNull();
    expect(occupantRefusal("k", "section", true)).toBeNull();
  });

  it("switches to a map only for a section holding a boolean under warnings", () => {
    const typed = ["sensors", "structure", "warnings", "cycle"];
    const steps = stepsFor(published, typed);

    expect(switchesToMap("section", "boolean", steps)).toBe(true);
    expect(switchesToMap("scalar", "boolean", steps)).toBe(false);
    expect(switchesToMap("section", "string", steps)).toBe(false);
    expect(
      switchesToMap("section", "boolean", stepsFor(published, ["a", "b"])),
    ).toBe(false);
  });

  it("states the not-a-list text", () => {
    expect(notAListRefusal("k", "scalar")).toBe("k is a scalar, not a list");
  });

  it("states the not-a-section text", () => {
    expect(notASectionRefusal("s", "list")).toBe("s is a list, not a section");
  });
});

describe("descent and unreachable texts", () => {
  it("names the subject when the parent path is empty", () => {
    expect(
      descentRefusal({
        parent: "",
        subject: "config",
        found: "scalar",
        wantsList: false,
      }),
    ).toBe("the config is a scalar, not a section");
  });

  it("names the dotted parent when it is not empty", () => {
    expect(
      descentRefusal({
        parent: "a.b",
        subject: "policy",
        found: "section",
        wantsList: true,
      }),
    ).toBe("a.b is a section, not a list of entries");
  });

  it("states each unreachable text", () => {
    expect(unreachableRefusal("set", "k")).toBe("k cannot be set here");
    expect(unreachableRefusal("add", "k")).toBe("k cannot be added to here");
    expect(unreachableRefusal("add-section", "k")).toBe(
      "k cannot be added here",
    );
  });

  it("states the unset-of-section text", () => {
    expect(sectionUnsetRefusal("k")).toBe(
      "k is a section; remove it with --remove-section",
    );
  });
});

describe("policy forbid rules and emptied holders", () => {
  it("removes a forbid rule written with or without the prefix on a policy list", () => {
    expect(forbidRuleRemoval("policy", "forbid", "list", "forbid={}")).toBe(
      true,
    );
    expect(forbidRuleRemoval("policy", "forbid", "list", "{}")).toBe(true);
  });

  it("does not treat the same raw as a forbid rule on a config subject", () => {
    expect(forbidRuleRemoval("config", "forbid", "list", "{}")).toBe(false);
    expect(forbidRuleRemoval("policy", "forbid", "list", "x")).toBe(false);
    expect(forbidRuleRemoval("policy", "forbid", "scalar", "{}")).toBe(false);
  });

  it("strips the forbid prefix", () => {
    expect(forbidRuleText("forbid={}")).toBe("{}");
    expect(forbidRuleText("{}")).toBe("{}");
  });

  it("drops an emptied holder under warnings", () => {
    const steps = stepsFor(published, [
      "sensors",
      "structure",
      "warnings",
      "long_function",
      "limit",
    ]);

    expect(dropsEmptyHolder(steps)).toBe(true);
  });

  it("drops an emptied holder for a describer root", () => {
    expect(dropsEmptyHolder(stepsFor(published, ["describer", "model"]))).toBe(
      true,
    );
  });

  it("keeps an emptied holder elsewhere", () => {
    expect(dropsEmptyHolder(stepsFor(published, ["a", "b"]))).toBe(false);
  });
});
