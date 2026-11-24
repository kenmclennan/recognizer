import { describe, expect, it } from "vitest";
import {
  LanguageBehaviour,
  type LanguageRule,
  unknownFilesOf,
} from "../../src/index.js";
import { repositoryInLanguages } from "../fakes/files-in-languages.js";

function toy(name: string): LanguageRule {
  return {
    name,
    extensions: [`.${name}`],
    files: [],
    skip: {
      directory_names: [],
      directory_prefixes: [],
      directory_suffixes: [],
      directory_markers: [],
      file_globs: [],
    },
  };
}

const MIXED = repositoryInLanguages({
  "z/b.zig": "zig",
  "a/one.toy": "toy",
  "s/b.swift": "swift",
  "s/a.swift": "swift",
});

describe("unknownFilesOf", () => {
  it("returns the files of unpublished languages, sorted", () => {
    expect(MIXED.files.length).toBeGreaterThan(0);

    expect(unknownFilesOf(MIXED, new LanguageBehaviour([toy("toy")]))).toEqual({
      languages: ["swift", "zig"],
      files: ["s/a.swift", "s/b.swift", "z/b.zig"],
    });
  });

  it("returns null when every language is published", () => {
    expect(MIXED.files.length).toBeGreaterThan(0);

    expect(
      unknownFilesOf(
        MIXED,
        new LanguageBehaviour([toy("toy"), toy("swift"), toy("zig")]),
      ),
    ).toBeNull();
  });

  it("returns every file when none is published", () => {
    expect(unknownFilesOf(MIXED, new LanguageBehaviour([]))).toEqual({
      languages: ["swift", "toy", "zig"],
      files: ["a/one.toy", "s/a.swift", "s/b.swift", "z/b.zig"],
    });
  });

  it("returns null for an empty scan", () => {
    expect(
      unknownFilesOf(
        repositoryInLanguages({}),
        new LanguageBehaviour([toy("toy")]),
      ),
    ).toBeNull();
  });
});
