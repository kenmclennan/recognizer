import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import { nodeIo } from "../src/cli.js";
import { inFileTestHashes } from "../src/rust-test-blocks.js";
import { currentTestsHash } from "../src/tests-hash.js";

const FIXTURE = join(
  import.meta.dirname,
  "../../fixtures/sensors/tests-digest/rust-in-file",
);

const EXPECTED = JSON.parse(
  readFileSync(
    join(
      import.meta.dirname,
      "../../fixtures/sensors/tests-digest/expected.json",
    ),
    "utf8",
  ),
) as { digest: string; entries: Record<string, string> };

function gitInit(root: string): void {
  execFileSync("git", ["-C", root, "init", "-q"]);
}

function fixtureCopy(): string {
  const root = makeTempDir("recognizer-in-file-");

  cpSync(FIXTURE, root, { recursive: true });
  gitInit(root);

  return root;
}

function repository(files: Record<string, string>): string {
  const root = makeTempDir("recognizer-in-file-");

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  gitInit(root);

  return root;
}

function entriesOf(files: Record<string, string>): string[] {
  const root = repository(files);

  return [
    ...inFileTestHashes(nodeIo(), root, Object.keys(files)).keys(),
  ].sort();
}

function edit(root: string, path: string, from: string, to: string): void {
  const text = readFileSync(join(root, path), "utf8");

  expect(text).toContain(from);

  writeFileSync(join(root, path), text.replace(from, to));
}

function digest(root: string): string | null {
  return currentTestsHash(nodeIo(), root, []);
}

describe("the parity fixture", () => {
  it("gives the shared digest", () => {
    expect(digest(fixtureCopy())).toBe(EXPECTED.digest);
  });

  it("gives the shared in-file entries", () => {
    const root = fixtureCopy();
    const paths = Object.keys(EXPECTED.entries).map((key) =>
      String(key.split("#")[0]),
    );
    const entries = Object.fromEntries(inFileTestHashes(nodeIo(), root, paths));
    const expected = Object.fromEntries(
      Object.entries(EXPECTED.entries).filter(([key]) => key.includes("#")),
    );

    expect(entries).toEqual(expected);
  });
});

describe("editing the fixture", () => {
  const unchanged: [string, string, string, string][] = [
    ["production code in a file with tests", "src/lib.rs", "a + b", "b + a"],
    ["production code in a declaring file", "src/more.rs", "x * 2", "x * 3"],
  ];
  const changed: [string, string, string, string][] = [
    [
      "a test body",
      "src/lib.rs",
      "assert_eq!(add(1, 2), 3)",
      "assert_eq!(add(1, 2), 4)",
    ],
    ["a declared test module file", "src/more/helper_tests.rs", ", 4)", ", 5)"],
    ["an inner test attribute file", "src/inner.rs", "    7\n", "    9\n"],
    ["a space inside a test item", "src/lib.rs", "fn adds()", "fn  adds()"],
  ];

  it.each(unchanged)(
    "leaves the digest when %s changes",
    (_name, path, from, to) => {
      const root = fixtureCopy();

      edit(root, path, from, to);

      expect(digest(root)).toBe(EXPECTED.digest);
    },
  );

  it.each(changed)(
    "changes the digest when %s changes",
    (_name, path, from, to) => {
      const root = fixtureCopy();

      edit(root, path, from, to);

      expect(digest(root)).not.toBe(EXPECTED.digest);

      edit(root, path, to, from);

      expect(digest(root)).toBe(EXPECTED.digest);
    },
  );

  it("changes the digest when two test items swap", () => {
    const root = fixtureCopy();
    const text = readFileSync(join(root, "src/lib.rs"), "utf8");
    const split = text.indexOf("#[cfg(all(test, unix))]");
    const modules = text.indexOf("#[cfg(test)]\nmod tests");
    const swapped =
      text.slice(0, split) +
      text.slice(modules) +
      "\n" +
      text.slice(split, modules);

    writeFileSync(join(root, "src/lib.rs"), swapped);

    expect(digest(root)).not.toBe(EXPECTED.digest);
  });

  it("changes the digest when the test module is deleted", () => {
    const root = fixtureCopy();
    const text = readFileSync(join(root, "src/lib.rs"), "utf8");

    writeFileSync(
      join(root, "src/lib.rs"),
      text.slice(0, text.indexOf("#[cfg(test)]\nmod tests")),
    );

    expect(digest(root)).not.toBe(EXPECTED.digest);
  });

  it("ends a declaration at its semicolon with or without a final newline", () => {
    const root = fixtureCopy();
    const text = readFileSync(join(root, "src/more.rs"), "utf8");

    writeFileSync(join(root, "src/more.rs"), text.trimEnd());

    expect(digest(root)).toBe(EXPECTED.digest);
  });

  it("finds a test item ending at the last byte of a file", () => {
    const root = fixtureCopy();

    writeFileSync(join(root, "src/at_eof.rs"), "#[test] fn at_eof() {}");

    expect(digest(root)).not.toBe(EXPECTED.digest);
  });

  it("leaves a deleted file's digest unreadable entry out", () => {
    const root = fixtureCopy();

    rmSync(join(root, "src/more/helper_tests.rs"));

    expect(digest(root)).not.toBe(EXPECTED.digest);
  });
});

describe("the lexer", () => {
  const none: [string, string][] = [
    ["a line comment", "// #[test]\nfn a() {}\n"],
    ["a nested block comment", "/* /* #[test] */ #[test] */\nfn a() {}\n"],
    ["a string", 'const A: &str = "#[test]";\n'],
    ["a raw string", 'const A: &str = r#"#[test]"#;\n'],
    ["a raw string of two hashes", 'const A: &str = r##"a"#b"##; // test\n'],
    ["a byte string", 'const A: &[u8] = b"#[test]";\n'],
    ["a raw byte string", 'const A: &[u8] = br#"#[test]"#;\n'],
    ["cfg_attr", "#[cfg_attr(test, derive(Debug))]\nstruct A;\n"],
    ["cfg not test", "#[cfg(not(test))]\nfn a() {}\n"],
    ["a feature named testing", '#[cfg(feature = "testing")]\nfn a() {}\n'],
  ];

  it.each(none)("adds no entry for %s", (_name, text) => {
    expect(entriesOf({ "src/a.rs": `${text}// test\n` })).toEqual([]);
  });

  it.each([
    ["a character brace", "fn a() { let c = '}'; }\n"],
    ["an escaped quote", "fn a() { let c = '\\''; }\n"],
    ["a byte brace", "fn a() { let c = b'}'; }\n"],
    ["a unicode escape", "fn a() { let c = '\\u{1F600}'; }\n"],
    ["a lifetime", "fn a<'a>(x: &'a str) -> &'a str { x }\n"],
  ])("does not end an item early on %s", (_name, body) => {
    const files = { "src/a.rs": `#[test]\n${body}fn after() {}\n` };

    expect(entriesOf(files)).toEqual(["src/a.rs#0"]);

    const hashes = inFileTestHashes(nodeIo(), repository(files), ["src/a.rs"]);
    const text = `#[test]\n${body}`.trimEnd();

    expect(hashes.get("src/a.rs#0")).toBe(
      execFileSync("shasum", ["-a", "256"], { input: text })
        .toString()
        .split(" ")[0],
    );
  });

  it.each([
    ["extra whitespace", "#[cfg( test )]\nfn a() {}\n"],
    ["all(test, unix)", "#[cfg(all(test, unix))]\nfn a() {}\n"],
    ["split lines", "#[cfg(\n    test\n)]\nfn a() {}\n"],
    [
      "a doc comment between attributes",
      "#[inline]\n/// doc\n#[test]\nfn a() {}\n",
    ],
    ["no final newline", "#[test]\nfn a() {}"],
  ])("finds one entry for %s", (_name, text) => {
    expect(entriesOf({ "src/a.rs": text })).toEqual(["src/a.rs#0"]);
  });

  it("skips a file with no test text", () => {
    expect(entriesOf({ "src/a.rs": "fn a() {}\n" })).toEqual([]);
  });

  it("does not scan a test file", () => {
    expect(entriesOf({ "tests/a.rs": "#[test]\nfn a() {}\n" })).toEqual([]);
  });
});

describe("declared test modules", () => {
  it("adds the listed files and only the item for an unlisted one", () => {
    const files = {
      "src/lib.rs":
        "#[cfg(test)]\nmod one;\n#[cfg(test)]\nmod two;\n#[cfg(test)]\nmod three;\n",
      "src/one.rs": "fn one() {}\n",
      "src/two/mod.rs": "fn two() {}\n",
    };

    expect(entriesOf(files)).toEqual([
      "src/lib.rs#0",
      "src/lib.rs#1",
      "src/lib.rs#2",
      "src/one.rs#file",
      "src/two/mod.rs#file",
    ]);
  });

  it("resolves a file reached from a non-mod file under its stem directory", () => {
    const files = {
      "src/lib.rs": "mod outer;\n",
      "src/outer.rs": "#[cfg(test)]\npub(crate) mod inner;\n",
      "src/outer/inner.rs": "fn x() {}\n",
      "src/inner.rs": "fn y() {}\n",
    };

    expect(entriesOf(files)).toEqual([
      "src/outer.rs#0",
      "src/outer/inner.rs#file",
    ]);
  });

  it("includes two files of one module name under the directory", () => {
    const files = {
      "src/lib.rs": "#[cfg(test)]\nmod x;\n",
      "src/x.rs": "fn a() {}\n",
      "src/deep/x.rs": "fn b() {}\n",
    };

    expect(entriesOf(files)).toEqual([
      "src/deep/x.rs#file",
      "src/lib.rs#0",
      "src/x.rs#file",
    ]);
  });
});

describe("real committed content", () => {
  it("finds one #0 entry in each app source file with a cfg(test) line", () => {
    const root = join(import.meta.dirname, "../..");
    const listed = execFileSync(
      "git",
      ["-C", root, "ls-files", "--", "app/src-tauri/src"],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter((path) => path.endsWith(".rs"));

    if (listed.length === 0) {
      return;
    }

    const expected = execFileSync(
      "git",
      [
        "-C",
        root,
        "grep",
        "-l",
        "-E",
        "^#\\[cfg\\(test\\)\\]",
        "--",
        "app/src-tauri/src",
      ],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter((path) => path !== "")
      .map((path) => `${path}#0`)
      .sort();

    expect(expected.length).toBeGreaterThan(0);
    expect([...inFileTestHashes(nodeIo(), root, listed).keys()].sort()).toEqual(
      expected,
    );
  });
});

describe("the test-gate predicate in a mixed file", () => {
  it("counts only the items that require test", () => {
    const text =
      "#[cfg(all(test, unix))]\nfn a() {}\n#[cfg(any(test, unix))]\nfn b() {}\n#[cfg(test)]\nfn c() {}\n";

    expect(entriesOf({ "src/a.rs": text })).toEqual([
      "src/a.rs#0",
      "src/a.rs#1",
    ]);
  });
});
