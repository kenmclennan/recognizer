import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  archiveEntries,
  buildGrammarWheel,
  exportArguments,
  grammarSource,
  mergeRequirements,
  verifyArchive,
} from "./build-toolchain.mjs";

const closure = ["node_modules/ajv", "node_modules/yaml"];
const grammarWheel =
  "tree_sitter_c_sharp-0.23.5-cp310-abi3-macosx_11_0_arm64.whl";
const wheelhouse = [
  "tree_sitter-0.26.0-cp313-cp313-macosx_11_0_arm64.whl",
  grammarWheel,
];
const PINNED_COMMIT = "f1c7c1ee21f56a33412c12efb8abe0c483f05f0d";

describe("archiveEntries", () => {
  it("names the vendored packages, the wheel, the notices and the licence", () => {
    expect(archiveEntries("1.2.3", closure, wheelhouse)).toEqual([
      "node_modules/recognizer/package.json",
      "node_modules/recognizer-scan-typescript/package.json",
      "node_modules/recognizer-describe-claude/package.json",
      "node_modules/ajv/package.json",
      "node_modules/yaml/package.json",
      "recognizer_scan_python-1.2.3-py3-none-any.whl",
      "recognizer_scan_kotlin-1.2.3-py3-none-any.whl",
      "recognizer_scan_csharp-1.2.3-py3-none-any.whl",
      "recognizer_sensors-1.2.3-py3-none-any.whl",
      "wheelhouse/tree_sitter-0.26.0-cp313-cp313-macosx_11_0_arm64.whl",
      `wheelhouse/${grammarWheel}`,
      "recognizer-scan-rust",
      "THIRD-PARTY-NOTICES.md",
      "LICENSE",
    ]);
  });
});

describe("mergeRequirements", () => {
  const kotlin =
    "# header\ntree-sitter==0.26.0 \\\n    --hash=sha256:aa \\\n    --hash=sha256:bb\ntree-sitter-kotlin==1.1.0 \\\n    --hash=sha256:cc\n";
  const sensors =
    "# header\ntree-sitter==0.26.0 \\\n    --hash=sha256:aa \\\n    --hash=sha256:bb\ntree-sitter-rust==0.24.2 \\\n    --hash=sha256:dd\ntree-sitter-kotlin==1.1.0 \\\n    --hash=sha256:cc\n";

  it("keeps each requirement once with its own hashes", () => {
    expect(mergeRequirements([kotlin, sensors])).toBe(
      "tree-sitter==0.26.0 \\\n    --hash=sha256:aa \\\n    --hash=sha256:bb\ntree-sitter-kotlin==1.1.0 \\\n    --hash=sha256:cc\ntree-sitter-rust==0.24.2 \\\n    --hash=sha256:dd\n",
    );
  });
});

describe("verifyArchive", () => {
  const full = `${archiveEntries("1.2.3", closure, wheelhouse).join("\n")}\n`;

  it("accepts a complete listing", () => {
    expect(() =>
      verifyArchive(full, "1.2.3", closure, wheelhouse),
    ).not.toThrow();
  });

  it("accepts a listing whose names carry a leading ./", () => {
    const listing = archiveEntries("1.2.3", closure, wheelhouse)
      .map((name) => `./${name}`)
      .join("\n");

    expect(() =>
      verifyArchive(listing, "1.2.3", closure, wheelhouse),
    ).not.toThrow();
  });

  it("fails when the wheel is missing", () => {
    const listing = full.replace(/recognizer_scan_python.*\n/, "");

    expect(() => verifyArchive(listing, "1.2.3", closure, wheelhouse)).toThrow(
      /recognizer_scan_python/,
    );
  });

  it.each([
    ["the Rust binary", "recognizer-scan-rust\n", /recognizer-scan-rust/],
    [
      "the Kotlin wheel",
      "recognizer_scan_kotlin-1.2.3-py3-none-any.whl\n",
      /recognizer_scan_kotlin/,
    ],
    [
      "the C# wheel",
      "recognizer_scan_csharp-1.2.3-py3-none-any.whl\n",
      /recognizer_scan_csharp/,
    ],
    [
      "the sensors wheel",
      "recognizer_sensors-1.2.3-py3-none-any.whl\n",
      /recognizer_sensors/,
    ],
    [
      "a wheelhouse file",
      "wheelhouse/tree_sitter-0.26.0-cp313-cp313-macosx_11_0_arm64.whl\n",
      /wheelhouse\/tree_sitter/,
    ],
    [
      "the grammar wheel",
      `wheelhouse/${grammarWheel}\n`,
      /wheelhouse\/tree_sitter_c_sharp-/,
    ],
    [
      "the describer",
      "node_modules/recognizer-describe-claude/package.json\n",
      /recognizer-describe-claude/,
    ],
  ])("fails when %s is missing", (_, entry, pattern) => {
    expect(() =>
      verifyArchive(full.replace(entry, ""), "1.2.3", closure, wheelhouse),
    ).toThrow(pattern);
  });

  it("fails when the notices file is missing", () => {
    const listing = full.replace("THIRD-PARTY-NOTICES.md\n", "");

    expect(() => verifyArchive(listing, "1.2.3", closure, wheelhouse)).toThrow(
      /THIRD-PARTY-NOTICES\.md/,
    );
  });

  it("fails when a closure package is missing", () => {
    const listing = full.replace("node_modules/yaml/package.json\n", "");

    expect(() => verifyArchive(listing, "1.2.3", closure, wheelhouse)).toThrow(
      /node_modules\/yaml/,
    );
  });

  it("fails for a listing built for another version", () => {
    expect(() => verifyArchive(full, "1.2.4", closure, wheelhouse)).toThrow(
      /1\.2\.4/,
    );
  });
});

describe("the grammar wheel", () => {
  const pyproject = readFileSync(
    fileURLToPath(
      new URL("../scanners/csharp/pyproject.toml", import.meta.url),
    ),
    "utf8",
  );

  it("reads the pinned commit from the scanner's pyproject", () => {
    expect(grammarSource(pyproject)).toEqual({
      url: "https://github.com/tree-sitter/tree-sitter-c-sharp",
      rev: PINNED_COMMIT,
    });
  });

  it("refuses a pyproject with no pinned git source", () => {
    expect(() => grammarSource('[project]\nname = "x"\n')).toThrow(
      /no pinned git source/,
    );
  });

  it("keeps the grammar out of the hash-checked requirements", () => {
    const args = exportArguments();

    expect(args.slice(args.indexOf("--no-emit-package"))).toEqual([
      "--no-emit-package",
      "tree-sitter-c-sharp",
      "--format",
      "requirements-txt",
    ]);
  });

  it("fetches the pinned commit, checks it out and builds one wheel into the wheelhouse", () => {
    const calls = [];
    const exec = (command, args, options = {}) => {
      calls.push([command, args, options.cwd]);

      return command === "git" && args[0] === "rev-parse"
        ? `${PINNED_COMMIT}\n`
        : "";
    };

    buildGrammarWheel(grammarSource(pyproject), "/wheelhouse", exec);

    const cwd = calls[0][2];

    expect(
      calls.map(([command, args]) => [command, ...args.slice(0, 2)]),
    ).toEqual([
      ["git", "init", "--quiet"],
      ["git", "remote", "add"],
      ["git", "fetch", "--quiet"],
      ["git", "checkout", "--quiet"],
      ["git", "rev-parse", "HEAD"],
      ["uv", "build", "--wheel"],
    ]);
    expect(calls[2][1]).toEqual([
      "fetch",
      "--quiet",
      "--depth",
      "1",
      "origin",
      PINNED_COMMIT,
    ]);
    expect(calls[5][1]).toEqual([
      "build",
      "--wheel",
      "--out-dir",
      "/wheelhouse",
      cwd,
    ]);
  });

  it("refuses a checkout that is not the pinned commit", () => {
    const exec = (command, args) =>
      command === "git" && args[0] === "rev-parse" ? "deadbeef\n" : "";

    expect(() =>
      buildGrammarWheel(grammarSource(pyproject), "/wheelhouse", exec),
    ).toThrow(/not the pinned/);
  });
});
