import { describe, expect, it } from "vitest";
import {
  LanguageBehaviour,
  type LanguageRule,
  type TestFileRule,
} from "../../src/index.js";

function rule(over: Partial<TestFileRule> = {}): TestFileRule {
  return {
    extensions: [],
    directory_names: [],
    directory_suffixes: [],
    basename_patterns: [],
    stem_suffixes: [],
    ...over,
  };
}

function language(over: Partial<LanguageRule> = {}): LanguageRule {
  return {
    name: "toy",
    extensions: [".toy"],
    files: [],
    skip: {
      directory_names: [],
      directory_prefixes: [],
      directory_suffixes: [],
      directory_markers: [],
      file_globs: [],
    },
    ...over,
  };
}

function behaviourOf(...rules: TestFileRule[]): LanguageBehaviour {
  return new LanguageBehaviour([language({ test_files: rules })]);
}

describe("LanguageBehaviour.isTestFile", () => {
  it("matches a directory name", () => {
    const behaviour = behaviourOf(rule({ directory_names: ["checks"] }));

    expect(behaviour.isTestFile("src/checks/a.toy")).toBe(true);
    expect(behaviour.isTestFile("src/a.toy")).toBe(false);
  });

  it("matches a directory suffix on directories only", () => {
    const behaviour = behaviourOf(rule({ directory_suffixes: ["Spec"] }));

    expect(behaviour.isTestFile("AppSpec/a.toy")).toBe(true);
    expect(behaviour.isTestFile("app/ASpec")).toBe(false);
  });

  it("matches a basename pattern", () => {
    const behaviour = behaviourOf(rule({ basename_patterns: ["^check_.*$"] }));

    expect(behaviour.isTestFile("src/check_a.toy")).toBe(true);
    expect(behaviour.isTestFile("src/a_check.toy")).toBe(false);
  });

  it("matches a stem suffix", () => {
    const behaviour = behaviourOf(rule({ stem_suffixes: ["Check"] }));

    expect(behaviour.isTestFile("src/AppCheck.toy")).toBe(true);
    expect(behaviour.isTestFile("src/AppCheck.toy.txt")).toBe(false);
  });

  it("a rule limited to an extension ignores other extensions", () => {
    const behaviour = behaviourOf(
      rule({ extensions: [".cs"], directory_suffixes: ["Tests"] }),
    );

    expect(behaviour.isTestFile("AppTests/a.cs")).toBe(true);
    expect(behaviour.isTestFile("AppTests/a.kt")).toBe(false);
  });

  it("a path matches a rule of another language", () => {
    const behaviour = new LanguageBehaviour([
      language({ name: "one", test_files: [rule({ directory_names: ["t"] })] }),
      language({ name: "two", extensions: [".two"] }),
    ]);

    expect(behaviour.isTestFile("t/a.two")).toBe(true);
  });

  it("a path matching no rule is not a test file", () => {
    expect(new LanguageBehaviour([language()]).isTestFile("t/a.toy")).toBe(
      false,
    );
  });
});

describe("LanguageBehaviour flags", () => {
  const behaviour = new LanguageBehaviour([
    language({ name: "yes", supertype_links: true, private_imports: true }),
    language({ name: "no", supertype_links: false, private_imports: false }),
  ]);

  it("a published flag is true", () => {
    expect(behaviour.linksSupertypes("yes")).toBe(true);
    expect(behaviour.checksPrivateImports("yes")).toBe(true);
  });

  it("an unpublished flag is false", () => {
    expect(behaviour.linksSupertypes("no")).toBe(false);
    expect(behaviour.checksPrivateImports("no")).toBe(false);
  });

  it("an unlisted language links no supertype", () => {
    expect(behaviour.linksSupertypes("other")).toBe(false);
  });

  it("an unlisted language checks no private import", () => {
    expect(behaviour.checksPrivateImports("other")).toBe(false);
  });
});
