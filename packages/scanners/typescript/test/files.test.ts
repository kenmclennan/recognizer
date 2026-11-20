import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../../scripts/temp-dirs.mjs";
import { scan } from "../src/index.js";
import {
  makeTree,
  REPO,
  readJson,
  runBin,
  scanTree,
  validate,
} from "./helpers.js";

describe("skip rules", () => {
  it("keeps only unskipped files", () => {
    const body = "export const x = 1;\n";
    const doc = scanTree({
      "keep.mjs": body,
      "keep.cjs": "module.exports = {};\n",
      "keep.mts": body,
      "keep.cts": "module.exports = {};\n",
      "src/a.d.mts": "declare const x: number;\n",
      "src/a.d.cts": "declare const x: number;\n",
      "src/a.test.mts": body,
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

    expect(doc.modules.map((m) => m.id)).toEqual([
      "keep.cjs",
      "keep.cts",
      "keep.mjs",
      "keep.mts",
    ]);
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

  it.each(cases)("scans past a damaged %s and names it", (name, content) => {
    const okSource = "export const ok = 1;\n";
    const root = makeTree({ [name]: content, "ok.ts": okSource });
    const result = runBin(root);

    expect(result.status).toBe(0);

    const doc = JSON.parse(result.stdout);
    validate(doc);

    const ids = doc.modules.map((m: { id: string }) => m.id);

    expect(ids).toContain("ok.ts");
    expect(ids).toContain(name);

    const alone = JSON.parse(runBin(makeTree({ "ok.ts": okSource })).stdout);
    const pick = (d: { modules: { id: string }[] }) =>
      d.modules.find((m) => m.id === "ok.ts");

    expect(pick(doc)).toEqual(pick(alone));
    expect(
      result.stderr.match(
        new RegExp(`damaged file ${name.replace(".", "\\.")}: `, "g"),
      ),
    ).toHaveLength(1);
    expect(result.stderr).toContain("1 of 2 files had damaged spans");
  });

  it("names every damaged file once and writes the scan to --output", () => {
    const root = makeTree({
      "a.ts": "export const = ;\n",
      "b.js": "function (\n",
    });
    const output = join(makeTree({}), "out.json");
    const result = runBin(root, "--output", output);

    expect(result.status).toBe(0);
    expect(() => JSON.parse(readFileSync(output, "utf8"))).not.toThrow();
    expect(result.stderr.match(/damaged file a\.ts:/g)).toHaveLength(1);
    expect(result.stderr.match(/damaged file b\.js:/g)).toHaveLength(1);
    expect(result.stderr).toContain("2 of 2 files had damaged spans");
    expect(result.stderr).not.toMatch(/^a\.ts:\d+:/m);
  });

  it("keeps edges between good files beside a damaged file", () => {
    const root = makeTree({
      "a.ts": 'import { b } from "./b";\nexport const a = b;\n',
      "b.ts": "export const b = 1;\n",
      "c.ts": "export const = ;\n",
    });
    const result = runBin(root);

    expect(result.status).toBe(0);
    expect(
      JSON.parse(result.stdout).edges.some(
        (e: { from: string; to: string }) =>
          e.from === "a.ts" && e.to === "b.ts",
      ),
    ).toBe(true);
  });

  it("exits 2 for a nonexistent ROOT", () => {
    const result = runBin(join(tmpdir(), "recognizer-ts-missing-root"));

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
  });
});
