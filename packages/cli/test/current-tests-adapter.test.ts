import type { LanguageRule } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { currentTestsDigest } from "../src/adapters/filesystem/current-tests-adapter.js";

function rule(published: boolean): LanguageRule {
  return {
    name: "python",
    extensions: [".py"],
    files: [],
    ...(published
      ? {
          test_files: [
            {
              extensions: [],
              directory_names: ["tests"],
              directory_suffixes: [],
              basename_patterns: [],
              stem_suffixes: [],
            },
          ],
        }
      : {}),
    skip: {
      directory_names: [],
      directory_prefixes: [],
      directory_suffixes: [],
      directory_markers: [],
      file_globs: [],
    },
  };
}

function portsOver(rules: LanguageRule[], content: string) {
  return {
    source: {
      listFiles: () => ["tests/a.py"],
      hashOf: () => content,
      readText: () => null,
    },
    digest: { sha256: (text: string) => `sha:${text}` },
    testReports: { entries: () => new Map<string, string>() },
    languages: { rules: () => rules },
  };
}

describe("the current tests digest the service compares results against", () => {
  it("a_scanner_that_publishes_test_rules_gives_a_digest_that_follows_the_test_files", () => {
    const first = currentTestsDigest(portsOver([rule(true)], "h1"), "/r");
    const second = currentTestsDigest(portsOver([rule(true)], "h2"), "/r");

    expect(first).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it("no_scanner_publishing_test_rules_leaves_the_digest_unknown_so_a_result_is_not_called_out_of_date", () => {
    expect(currentTestsDigest(portsOver([rule(false)], "h1"), "/r")).toBeNull();
    expect(currentTestsDigest(portsOver([], "h1"), "/r")).toBeNull();
  });
});
