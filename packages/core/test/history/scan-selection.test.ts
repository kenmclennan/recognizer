import { describe, expect, it } from "vitest";
import { ScanSelection } from "../../src/index.js";

function skipping(paths: string[]): ScanSelection {
  return new ScanSelection({
    extensions: [".cs"],
    skipDirectoryNames: [],
    skipDirectoryPrefixes: [],
    skipDirectorySuffixes: [],
    skipDirectoriesContaining: [],
    skipFileGlobs: [],
    skipPaths: paths,
  });
}

const NONE = new Set<string>();

describe("ScanSelection", () => {
  it("a file under a listed skip path is not accepted", () => {
    const selection = skipping(["src/Foo.Tests"]);

    expect(selection.accepts("src/Foo.Tests/A.cs", NONE)).toBe(false);
    expect(selection.accepts("src/Foo.Tests/Deep/B.cs", NONE)).toBe(false);
    expect(selection.skipsDirectory("src/Foo.Tests", NONE)).toBe(true);
    expect(selection.skipsDirectory("src/Foo.Tests/Deep", NONE)).toBe(true);
    expect(selection.skipsDirectory("src", NONE)).toBe(false);
  });

  it("a sibling that only shares a string prefix with a skip path is accepted", () => {
    const selection = skipping(["src/Foo.Tests"]);

    expect(selection.accepts("src/Foo.Tests2/A.cs", NONE)).toBe(true);
    expect(selection.accepts("src/Foo/A.cs", NONE)).toBe(true);
    expect(selection.skipsDirectory("src/Foo.Tests2", NONE)).toBe(false);
  });

  it("a dot skip path skips every file", () => {
    const selection = skipping(["."]);

    expect(selection.accepts("A.cs", NONE)).toBe(false);
    expect(selection.accepts("src/A.cs", NONE)).toBe(false);
  });

  it("a selection with no skip paths accepts what it always did", () => {
    const selection = skipping([]);

    expect(selection.accepts("A.cs", NONE)).toBe(true);
    expect(selection.accepts("src/Foo.Tests/A.cs", NONE)).toBe(true);
  });

  it("a glob treats star as any run of characters and nothing else", () => {
    const matches = ScanSelection.globMatches;

    expect(matches("test_*.py", "test_a.py")).toBe(true);
    expect(matches("test_*.py", "test_.py")).toBe(true);
    expect(matches("test_*.py", "atest_a.py")).toBe(false);
    expect(matches("*.test.*", ".test.ts")).toBe(true);
    expect(matches("*.d.ts", "a.d.ts")).toBe(true);
    expect(matches("*.d.ts", "a.ts")).toBe(false);
    expect(matches("conftest.py", "conftest.py")).toBe(true);
    expect(matches("conftest.py", "conftest.pyc")).toBe(false);
    expect(matches("a?c", "abc")).toBe(false);
  });
});
