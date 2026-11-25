import { readFileSync } from "node:fs";
import { ScanSelection } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { repositoryFrom } from "./repository-from.js";

function selectionOf(extensions: string[]) {
  return {
    extensions,
    skipDirectoryNames: ["test", "tests"],
    skipDirectoryPrefixes: [],
    skipDirectorySuffixes: [],
    skipDirectoriesContaining: [],
    skipFileGlobs: [],
  };
}

describe("ScanSelection.accepts", () => {
  const parity = JSON.parse(
    readFileSync(
      new URL("../../../fixtures/selection-parity.json", import.meta.url),
      "utf8",
    ),
  ) as Record<string, { tree: string[]; accepted: string[] }>;

  for (const language of Object.keys(parity)) {
    it(`accepts exactly the ${language} files the scanner reads`, () => {
      const expected = JSON.parse(
        readFileSync(
          new URL(
            `../../../fixtures/${language}/expected-scan.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      ) as { selection: Record<string, unknown> };
      const tree = new Set(parity[language]?.tree);
      const accepted = [...tree]
        .filter((path) =>
          new ScanSelection(
            repositoryFrom({ modules: [], selection: expected.selection })
              .extractions[0]?.selection as never,
          ).accepts(path, tree),
        )
        .sort();

      expect(accepted).toEqual(parity[language]?.accepted);
    });
  }

  it("rejects a path under skip_paths", () => {
    const selection = { ...selectionOf([".py"]), skipPaths: ["vendor"] };

    expect(new ScanSelection(selection).accepts("vendor/a.py")).toBe(false);
    expect(new ScanSelection(selection).accepts("vendor2/a.py")).toBe(true);
  });
});
