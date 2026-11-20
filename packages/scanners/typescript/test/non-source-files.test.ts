import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scan } from "../src/index.js";
import { ajvValidate, makeTree } from "./helpers.js";

const MODULE = "export const a = 1;\n";

function listed(root: string): string[] {
  const doc = scan(root, null);

  expect(ajvValidate(doc), JSON.stringify(ajvValidate.errors)).toBe(true);

  return doc.files.map((file) => file.path);
}

describe("non-source files in files", () => {
  it("lists a page and its package.json with the sha256 of their bytes", () => {
    const root = makeTree({
      "package.json": '{"name":"p"}',
      "index.html": '<script type="module" src="/a.ts"></script>',
      "a.ts": MODULE,
    });
    const doc = scan(root, null);

    expect(doc.files.map((file) => file.path)).toEqual([
      "a.ts",
      "index.html",
      "package.json",
    ]);

    for (const entry of doc.files) {
      const bytes = readFileSync(join(root, entry.path));

      expect(entry.hash).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
  });

  it("lists a path once and in sorted order", () => {
    const paths = listed(
      makeTree({
        "package.json": "{}",
        "b/package.json": "{}",
        "b/tsconfig.json": "{}",
        "b/x.ts": MODULE,
        "a.ts": MODULE,
      }),
    );

    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual([...paths].sort());
  });

  it("omits a manifest under a skipped directory", () => {
    const paths = listed(
      makeTree({
        "package.json": "{}",
        "node_modules/x/package.json": "{}",
        "a.ts": MODULE,
      }),
    );

    expect(paths).toEqual(["a.ts", "package.json"]);
  });

  it("lists an unparseable package.json", () => {
    expect(
      listed(makeTree({ "package.json": "{ not json", "a.ts": MODULE })),
    ).toEqual(["a.ts", "package.json"]);
  });

  it("lists an extended config and a referenced config", () => {
    const paths = listed(
      makeTree({
        "tsconfig.json": JSON.stringify({
          extends: "./base.json",
          references: [{ path: "./lib" }],
        }),
        "base.json": "{}",
        "lib/tsconfig.json": "{}",
        "lib/l.ts": MODULE,
      }),
    );

    expect(paths).toEqual([
      "base.json",
      "lib/l.ts",
      "lib/tsconfig.json",
      "tsconfig.json",
    ]);
  });

  it("parses but does not list a config extended from outside the root", () => {
    const tree = makeTree({
      "outside.json": '{"compilerOptions":{"strict":true}}',
      "repo/tsconfig.json": JSON.stringify({ extends: "../outside.json" }),
      "repo/a.ts": MODULE,
    });

    expect(listed(join(tree, "repo"))).toEqual(["a.ts", "tsconfig.json"]);
  });

  it("lists exactly the readable files inside the root in a mixed tree", () => {
    const tree = makeTree({
      "outside.json": "{}",
      "repo/package.json": "{ not json",
      "repo/ok/package.json": '{"name":"ok"}',
      "repo/ok/tsconfig.json": JSON.stringify({
        extends: "../../outside.json",
      }),
      "repo/ok/a.ts": MODULE,
      "repo/missing/tsconfig.json": JSON.stringify({
        extends: "./gone.json",
      }),
      "repo/missing/m.ts": MODULE,
      "repo/node_modules/dep/package.json": "{}",
    });

    expect(listed(join(tree, "repo"))).toEqual([
      "missing/tsconfig.json",
      "ok/a.ts",
      "ok/package.json",
      "ok/tsconfig.json",
      "package.json",
    ]);
  });
});

describe("absent tsconfig paths in the selection", () => {
  function absent(root: string): string[] | undefined {
    const doc = scan(root, null);

    expect(ajvValidate(doc), JSON.stringify(ajvValidate.errors)).toBe(true);

    return doc.selection.input_absent_paths;
  }

  it("lists a missing extends target", () => {
    const root = makeTree({
      "tsconfig.json": JSON.stringify({ extends: "./base.json" }),
      "a.ts": MODULE,
    });

    expect(absent(root)).toEqual(["base.json"]);
  });

  it("does not list a missing tsconfig.json", () => {
    const root = makeTree({
      "tsconfig.json": JSON.stringify({ references: [{ path: "./gone" }] }),
      "a.ts": MODULE,
    });

    expect(absent(root)).toBeUndefined();
  });

  it("lists only the missing one of a resolvable and a missing reference", () => {
    const root = makeTree({
      "tsconfig.json": JSON.stringify({
        files: [],
        references: [{ path: "./present.json" }, { path: "./gone.json" }],
      }),
      "present.json": JSON.stringify({ include: ["a.ts"] }),
      "a.ts": MODULE,
    });

    expect(absent(root)).toEqual(["gone.json"]);
    expect(listed(root)).toContain("present.json");
  });
});
