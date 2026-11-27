import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LanguageRule } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { currentTestsDigest } from "../src/adapters/filesystem/current-tests-adapter.js";
import { RepositoryFilesAdapter } from "../src/adapters/filesystem/repository-files-adapter.js";
import { SourceFilesAdapter } from "../src/adapters/filesystem/source-files-adapter.js";
import { nodeIo } from "../src/cli.js";

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
    repositoryFiles: {
      list: () => ({ from: "git" as const, paths: ["tests/a.py"] }),
    },
    source: {
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

describe("the tests digest in a folder that is not a git repository", () => {
  function plainFolder(): string {
    const root = makeTempDir("recognizer-plain-tests-");

    mkdirSync(join(root, "tests"));
    mkdirSync(join(root, "dist", "tests"), { recursive: true });
    writeFileSync(join(root, "tests", "a.py"), "one");
    writeFileSync(join(root, "dist", "tests", "b.py"), "one");

    return root;
  }

  function digestOf(root: string): string | null {
    return currentTestsDigest(
      {
        source: new SourceFilesAdapter(nodeIo()),
        repositoryFiles: new RepositoryFilesAdapter(nodeIo()),
        digest: { sha256: (text: string) => `sha:${text}` },
        testReports: { entries: () => new Map<string, string>() },
        languages: { rules: () => [rule(true)] },
      },
      root,
    );
  }

  it("a_test_edit_changes_the_digest_without_git", () => {
    const root = plainFolder();
    const before = digestOf(root);

    writeFileSync(join(root, "tests", "a.py"), "two");

    expect(before).not.toBeNull();
    expect(digestOf(root)).not.toBe(before);
  });

  it("an_edit_under_a_skipped_directory_leaves_the_digest_alone_without_git", () => {
    const root = plainFolder();
    const before = digestOf(root);

    writeFileSync(join(root, "dist", "tests", "b.py"), "two");

    expect(digestOf(root)).toBe(before);
  });
});
