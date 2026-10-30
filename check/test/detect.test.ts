import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
  ) as Record<"python" | "typescript", { tree: string[]; accepted: string[] }>;

  it.each(["python", "typescript"] as const)(
    "detects %s exactly when its scanner accepts a file of the shared tree",
    (language) => {
      const { tree, accepted } = parity[language];

      expect(detect(tree).languages.includes(language)).toBe(
        accepted.length > 0,
      );
    },
  );

  it.each(["python", "typescript"] as const)(
    "detects %s from no rejected file of the shared tree",
    (language) => {
      const { tree, accepted } = parity[language];
      const rejected = tree.filter((path) => !accepted.includes(path));

      expect(detect(rejected).languages.includes(language)).toBe(false);
    },
  );

  it.each(["python", "typescript"] as const)(
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
    [["readme.md"], []],
    [["types/index.d.ts"], []],
    [["a.js"], ["typescript"]],
    [["b.jsx"], ["typescript"]],
    [["c.mjs"], ["typescript"]],
    [["d.cjs"], ["typescript"]],
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
    ["test_a.py", []],
    ["a_test.py", []],
    ["conftest.py", []],
    ["test/a.py", ["python"]],
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

  it("stops walking once both languages are found", () => {
    const { languages, fake } = detect([
      "a.py",
      "b.ts",
      "z/deep/one.txt",
      "z/other/two.txt",
    ]);

    expect(languages).toEqual(["python", "typescript"]);
    expect(fake.readDirCalls()).toBe(1);
  });
});
