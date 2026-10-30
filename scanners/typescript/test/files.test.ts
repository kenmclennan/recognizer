import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import { scan } from "../src/index.js";
import { makeTree, REPO, readJson, runBin, scanTree } from "./helpers.js";

describe("skip rules", () => {
  it("keeps only unskipped files", () => {
    const body = "export const x = 1;\n";
    const doc = scanTree({
      "keep.mjs": body,
      "keep.cjs": "module.exports = {};\n",
      "node_modules/pkg/a.ts": body,
      "dist/a.ts": body,
      "build/a.ts": body,
      "test/a.ts": body,
      "tests/a.ts": body,
      "__tests__/a.ts": body,
      ".hidden/a.ts": body,
      "src/a.test.ts": body,
      "src/a.spec.tsx": body,
      "src/a.d.ts": "declare const x: number;\n",
      "src/readme.md": "x",
    });

    expect(doc.modules.map((m) => m.id)).toEqual(["keep.cjs", "keep.mjs"]);
  });

  it("does not follow a directory symlink to its own parent", () => {
    const root = makeTree({ "inner/a.ts": "export const a = 1;\n" });
    execFileSync("ln", ["-s", root, join(root, "inner", "loop")]);

    expect(scan(root, null).modules.map((m) => m.id)).toEqual(["inner/a.ts"]);
  });

  it("scans a root whose own name would match a skipped directory", () => {
    const parent = makeTempDir("recognizer-ts-");
    const root = join(parent, "dist");
    execFileSync("mkdir", [root]);
    execFileSync("sh", [
      "-c",
      `echo 'export const a = 1;' > ${join(root, "a.ts")}`,
    ]);

    expect(scan(root, null).modules.map((m) => m.id)).toEqual(["a.ts"]);
  });
});

describe("selection parity", () => {
  const parity = readJson(join(REPO, "fixtures/selection-parity.json")) as {
    typescript: { tree: string[]; accepted: string[] };
  };

  it("reads exactly the files the shared parity tree accepts", () => {
    const tree = Object.fromEntries(
      parity.typescript.tree.map((path) => [path, "export const x = 1;\n"]),
    );

    expect(scanTree(tree).files.map((f) => f.path)).toEqual(
      parity.typescript.accepted,
    );
  });
});

describe("modified", () => {
  const body = "export const a = 1;\n";

  it("is null outside git, false when clean and true when edited", () => {
    const outside = makeTree({ "a.ts": body });

    expect(JSON.parse(runBin(outside).stdout).modified).toBeNull();

    const root = makeTree({ "a.ts": body });
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        [
          "-c",
          "user.name=t",
          "-c",
          "user.email=t@example.com",
          "-C",
          root,
          ...args,
        ],
        { stdio: "ignore" },
      );
    git("init", "-q");
    git("add", "a.ts");
    git("commit", "-q", "-m", "x");

    expect(JSON.parse(runBin(root).stdout).modified).toBe(false);

    writeFileSync(join(root, "a.ts"), "export const a = 2;\n");

    expect(JSON.parse(runBin(root).stdout).modified).toBe(true);
    expect(
      JSON.parse(runBin(root, "--modified", "false").stdout).modified,
    ).toBe(false);
  });
});

describe("commit", () => {
  it("is null outside git", () => {
    const result = runBin(makeTree({ "a.ts": "export const a = 1;\n" }));

    expect(JSON.parse(result.stdout).commit).toBeNull();
  });

  it("is the full sha of a git repository", () => {
    const root = makeTree({ "a.ts": "export const a = 1;\n" });
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", ...args],
        {
          encoding: "utf8",
        },
      ).trim();

    git("init", "-q");
    git("add", "a.ts");
    git("commit", "-q", "-m", "x");

    expect(JSON.parse(runBin(root).stdout).commit).toBe(
      git("rev-parse", "HEAD"),
    );
  });
});

describe("failure behaviour", () => {
  const cases: [string, string][] = [
    ["a.ts", "export const = ;\n"],
    ["a.tsx", "export const a = <div>;\n"],
    ["a.js", "function (\n"],
    ["a.jsx", "const a = <b></c>;\n"],
  ];

  it.each(cases)("exits 2 naming %s", (name, content) => {
    const root = makeTree({
      [name]: content,
      "ok.ts": "export const ok = 1;\n",
    });
    const result = runBin(root);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(
      new RegExp(`${name.replace(".", "\\.")}:\\d+:`),
    );
  });

  it("names every bad file and writes nothing to --output", () => {
    const root = makeTree({
      "a.ts": "export const = ;\n",
      "b.js": "function (\n",
    });
    const output = join(makeTree({}), "out.json");
    const result = runBin(root, "--output", output);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("a.ts:1:");
    expect(result.stderr).toContain("b.js:1:");
    expect(() => execFileSync("test", ["-e", output])).toThrow();
  });

  it("exits 2 for a nonexistent ROOT", () => {
    const result = runBin(join(tmpdir(), "recognizer-ts-missing-root"));

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
  });
});
