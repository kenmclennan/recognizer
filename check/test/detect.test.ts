import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import { nodeIo } from "../src/cli.js";
import { detectLanguages } from "../src/detect.js";
import { REPO } from "./helpers.js";
import { fakeIo, ROOT } from "./scan-helpers.js";

function detect(files: string[], symlinks: string[] = []) {
  const fake = fakeIo({
    files: Object.fromEntries(files.map((file) => [`${ROOT}/${file}`, ""])),
    symlinks: symlinks.map((link) => `${ROOT}/${link}`),
  });

  return { languages: detectLanguages(fake.io, ROOT), fake };
}

describe("selection parity", () => {
  const parity = JSON.parse(
    readFileSync(join(REPO, "fixtures/selection-parity.json"), "utf8"),
  ) as Record<
    "python" | "typescript" | "kotlin" | "rust" | "csharp",
    { tree: string[]; accepted: string[] }
  >;

  it.each(["python", "typescript", "kotlin", "rust", "csharp"] as const)(
    "detects %s exactly when its scanner accepts a file of the shared tree",
    (language) => {
      const { tree, accepted } = parity[language];

      expect(detect(tree).languages.includes(language)).toBe(
        accepted.length > 0,
      );
    },
  );

  it.each(["python", "typescript", "kotlin", "rust", "csharp"] as const)(
    "detects %s from no rejected file of the shared tree",
    (language) => {
      const { tree, accepted } = parity[language];
      const rejected = tree.filter((path) => !accepted.includes(path));

      expect(detect(rejected).languages.includes(language)).toBe(false);
    },
  );

  it.each(["python", "typescript", "kotlin", "rust", "csharp"] as const)(
    "detects %s from each accepted file alone",
    (language) => {
      for (const path of parity[language].accepted) {
        expect(detect([path]).languages).toEqual([language]);
      }
    },
  );
});

describe("detectLanguages", () => {
  it.each([
    [["a.py"], ["python"]],
    [["tsconfig.json"], ["typescript"]],
    [["src/a.ts"], ["typescript"]],
    [["src/a.tsx"], ["typescript"]],
    [
      ["a.py", "src/a.ts"],
      ["python", "typescript"],
    ],
    [["src/A.kt"], ["kotlin"]],
    [["build.gradle.kts"], []],
    [["build/A.kt"], []],
    [[".gradle/A.kt"], []],
    [["src/test/kotlin/ATest.kt"], []],
    [["src/main/kotlin/ATest.kt"], []],
    [["src/androidTest/kotlin/A.kt"], []],
    [["src/lib.rs"], ["rust"]],
    [["tests/it.rs"], []],
    [["benches/b.rs"], ["rust"]],
    [["Cargo.toml"], []],
    [["target/debug/gen.rs"], []],
    [["node_modules/pkg/lib.rs"], []],
    [[".cargo/hidden.rs"], []],
    [["readme.md"], []],
    [["types/index.d.ts"], []],
    [["a.js"], ["typescript"]],
    [["b.jsx"], ["typescript"]],
    [["c.mjs"], ["typescript"]],
    [["d.cjs"], ["typescript"]],
    [["a.mts"], ["typescript"]],
    [["b.cts"], ["typescript"]],
    [["types/index.d.mts"], []],
    [["types/index.d.cts"], []],
    [["src/a.test.mts"], []],
    [["src/a.test.js"], []],
    [["types/index.d.ts"], []],
  ])("detects %j as %j", (files, expected) => {
    expect(detect(files).languages).toEqual(expected);
  });

  it.each([
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "dist",
    "build",
    ".worktrees",
    ".recognizer",
  ])("does not enter %s at any depth", (name) => {
    const files = [
      `${name}/decoy.py`,
      `${name}/decoy.ts`,
      `deep/${name}/decoy.py`,
      `deep/${name}/decoy.ts`,
    ];

    expect(detect(files).languages).toEqual([]);
  });

  it.each([
    ["tests/a.ts", []],
    ["src/__tests__/a.ts", []],
    ["test/a.ts", []],
    [".storybook/a.ts", []],
    [".config/tsconfig.json", []],
    ["src/a.test.ts", []],
    ["src/a.spec.tsx", []],
    ["tests/a.py", []],
    [".tools/a.py", []],
    ["pkg.egg-info/a.py", []],
    ["env/pyvenv.cfg", []],
    ["test_a.py", ["python"]],
    ["a_test.py", ["python"]],
    ["tests/test_a.py", []],
    ["test/test_a.py", []],
    ["pkg/test_helpers.py", ["python"]],
    ["conftest.py", []],
    ["test/a.py", []],
    ["__pycache__/a.py", []],
    ["site-packages/a.py", []],
  ])("skips what the scanner skips: %s", (file, expected) => {
    expect(detect([file]).languages).toEqual(expected);
  });

  it("skips a virtual environment only for python", () => {
    expect(
      detect(["env/pyvenv.cfg", "env/a.py", "env/b.ts"]).languages,
    ).toEqual(["typescript"]);
  });

  it("matches skipped directories by exact name", () => {
    expect(detect(["my_build/a.py"]).languages).toEqual(["python"]);
  });

  it("does not follow directory symlinks", () => {
    expect(detect(["readme.md"], ["loop"]).languages).toEqual([]);
  });

  it("stops walking once every language is found", () => {
    const { languages, fake } = detect([
      "a.py",
      "b.ts",
      "c.kt",
      "d.rs",
      "e.cs",
      "z/deep/one.txt",
      "z/other/two.txt",
    ]);

    expect(languages).toEqual([
      "python",
      "typescript",
      "kotlin",
      "rust",
      "csharp",
    ]);
    expect(fake.readDirCalls()).toBe(1);
  });
});

describe("git listing", () => {
  function detectListed(
    files: string[],
    tracked: string[] | undefined,
    extra: Parameters<typeof fakeIo>[0] = {},
  ) {
    const fake = fakeIo({
      files: Object.fromEntries(files.map((file) => [`${ROOT}/${file}`, ""])),
      tracked,
      ...extra,
    });

    return { languages: detectLanguages(fake.io, ROOT), fake };
  }

  it("detects no language that is present only in an ignored folder", () => {
    const { languages } = detectListed(
      ["bin/A.kt", "src/a.py"],
      ["src/a.py", ".gitignore"],
    );

    expect(languages).toEqual(["python"]);
  });

  it("detects a language from an untracked file git still lists", () => {
    expect(detectListed(["new.kt"], ["new.kt"]).languages).toEqual(["kotlin"]);
  });

  it("detects a language from a tracked file the gitignore also names", () => {
    expect(
      detectListed(["out/a.cs"], ["out/a.cs", ".gitignore"]).languages,
    ).toEqual(["csharp"]);
  });

  it("detects nothing for a tracked file deleted from disk", () => {
    expect(
      detectListed(["readme.md"], ["gone.kt", "readme.md"]).languages,
    ).toEqual([]);
  });

  it("detects exactly the languages of listed files in a mixed tree", () => {
    const { languages } = detectListed(
      ["a.py", "n.kt", "bin/A.rs", "src/e.cs"],
      ["a.py", "n.kt", "gone.ts", ".gitignore"],
    );

    expect(languages).toEqual(["python", "kotlin"]);
  });

  it("walks every file when there is no listing", () => {
    expect(detectListed(["bin/A.kt"], undefined).languages).toEqual(["kotlin"]);
  });

  it("walks every file and warns when git refuses for another reason", () => {
    const { languages, fake } = detectListed(["bin/A.kt"], undefined, {
      listing: {
        status: 128,
        stderr: "fatal: detected dubious ownership in repository\nmore\n",
      },
    });

    expect(languages).toEqual(["kotlin"]);
    expect(fake.err()).toBe(
      "recognizer: git could not list files (fatal: detected dubious ownership in repository); scanning every file\n",
    );
  });

  it("walks every file without a warning when git is not installed", () => {
    const { languages, fake } = detectListed(["bin/A.kt"], undefined, {
      listing: { started: false },
    });

    expect(languages).toEqual(["kotlin"]);
    expect(fake.err()).toBe("");
  });
});

describe("git listing in real repositories", () => {
  function write(root: string, files: Record<string, string>) {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
  }

  function git(root: string, args: string[]) {
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
      { cwd: root, stdio: "ignore" },
    );
  }

  function initRepository(files: Record<string, string>) {
    const root = makeTempDir("recognizer-detect-git-");
    write(root, files);
    git(root, ["init", "-q"]);
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "init"]);

    return root;
  }

  it("detects nothing from a nested repository and does not fail", () => {
    const root = initRepository({ "readme.md": "" });
    write(root, { "inner/A.kt": "" });
    git(join(root, "inner"), ["init", "-q"]);

    expect(detectLanguages(nodeIo(), root)).toEqual([]);
  });

  it("detects a subfolder root from its own tracked files only", () => {
    const root = initRepository({
      ".gitignore": "sub/bin/\n",
      "sub/src/a.py": "",
      "other/B.kt": "",
    });
    write(root, { "sub/bin/C.rs": "" });

    expect(detectLanguages(nodeIo(), join(root, "sub"))).toEqual(["python"]);
  });

  it("detects this checkout's languages from the files git lists", () => {
    const listed = execFileSync(
      "git",
      [
        "-C",
        REPO,
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    )
      .split("\0")
      .filter((entry) => entry !== "");

    const expected = detectLanguages(
      fakeIo({
        files: Object.fromEntries(
          listed.map((file) => [`${ROOT}/${file}`, ""]),
        ),
      }).io,
      ROOT,
    );

    expect(detectLanguages(nodeIo(), REPO)).toEqual(expected);
  });
});
