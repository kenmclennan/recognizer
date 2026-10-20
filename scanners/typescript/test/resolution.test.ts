import { describe, expect, it } from "vitest";
import { BUNDLER, edgeList, NODE16, scanTree } from "./helpers.js";

const x = "export const x = 1;\n";

describe("resolution", () => {
  it("maps ./x.js to x.ts under Node16", () => {
    const doc = scanTree({
      "tsconfig.json": NODE16,
      "package.json": '{"type":"module"}',
      "a.ts": 'import "./x.js";\n',
      "x.ts": x,
    });

    expect(edgeList(doc)).toEqual(["a.ts depends x.ts @1"]);
  });

  it("resolves extensionless and directory imports under bundler", () => {
    const doc = scanTree({
      "tsconfig.json": BUNDLER,
      "a.ts": 'import "./x";\nimport "./dir";\n',
      "x.ts": x,
      "dir/index.ts": x,
    });

    expect(edgeList(doc)).toEqual([
      "a.ts depends x.ts @1",
      "a.ts depends dir/index.ts @2",
    ]);
  });

  it("resolves a paths alias with baseUrl", () => {
    const doc = scanTree({
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          module: "ESNext",
          moduleResolution: "Bundler",
          baseUrl: ".",
          paths: { "@lib/*": ["lib/*"] },
        },
      }),
      "a.ts": 'import "@lib/x";\nimport "lib/x";\n',
      "lib/x.ts": x,
    });

    expect(edgeList(doc)).toEqual([
      "a.ts depends lib/x.ts @1",
      "a.ts depends lib/x.ts @2",
    ]);
    expect(doc.foreign).toEqual([]);
  });

  const workspaceTree = {
    "package.json": '{"workspaces":["packages/*"]}',
    "tsconfig.json": BUNDLER,
    "packages/pkg/package.json":
      '{"name":"@w/pkg","main":"dist/index.js","types":"dist/index.d.ts"}',
    "packages/pkg/src/index.ts": x,
    "packages/pkg/src/deep.ts": x,
    "packages/app/package.json": '{"name":"@w/app"}',
    "packages/app/src/a.ts":
      'import "@w/pkg";\nimport "@w/pkg/src/deep";\nimport "@w/pkg/deep";\nimport "@w/pkg/nothing";\n',
  };

  it("falls back to src/index for a workspace package with no node_modules", () => {
    const doc = scanTree(workspaceTree);

    expect(edgeList(doc, "packages/app/src/a.ts")).toEqual([
      "packages/app/src/a.ts depends packages/pkg/src/index.ts @1",
      "packages/app/src/a.ts depends packages/pkg/src/deep.ts @2",
      "packages/app/src/a.ts depends packages/pkg/src/deep.ts @3",
    ]);
    expect(doc.foreign).toEqual([]);
  });

  it("falls back through a node_modules symlink whose main is missing", () => {
    const doc = scanTree(workspaceTree, {
      "node_modules/@w/pkg": "packages/pkg",
    });

    expect(edgeList(doc, "packages/app/src/a.ts")).toContain(
      "packages/app/src/a.ts depends packages/pkg/src/index.ts @1",
    );
    expect(doc.foreign).toEqual([]);
  });

  it("gives no edge and no node for a workspace import with no file", () => {
    const doc = scanTree({
      ...workspaceTree,
      "packages/app/src/a.ts": 'import "@w/pkg/nothing";\n',
    });

    expect(doc.edges).toEqual([]);
    expect(doc.foreign).toEqual([]);
  });

  it("separates project edges, foreign nodes and unresolved specifiers", () => {
    const doc = scanTree({
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          module: "ESNext",
          moduleResolution: "Bundler",
          baseUrl: ".",
          paths: { "@alias/*": ["lib/*"] },
        },
      }),
      "a.ts": [
        'import "@alias/x";',
        'import "react";',
        'import "node:fs";',
        'import "./missing";',
        'import "@alias/missing";',
        "",
      ].join("\n"),
      "lib/x.ts": x,
    });

    expect(edgeList(doc, "a.ts")).toEqual([
      "a.ts depends lib/x.ts @1",
      "a.ts depends foreign:react @2",
      "a.ts depends foreign:node:fs @3",
    ]);
    expect(doc.foreign.map((f) => f.name)).toEqual(["node:fs", "react"]);
  });

  it("treats a bare package resolved into node_modules as foreign", () => {
    const doc = scanTree({
      "tsconfig.json": BUNDLER,
      "a.ts": 'import "lodash/fp";\n',
      "node_modules/lodash/package.json": '{"name":"lodash"}',
      "node_modules/lodash/fp.js": "module.exports = {};\n",
    });

    expect(edgeList(doc)).toEqual(["a.ts depends foreign:lodash @1"]);
  });

  it("gives an unresolved alias matching a paths key no edge and no node", () => {
    const doc = scanTree({
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          module: "ESNext",
          moduleResolution: "Bundler",
          baseUrl: ".",
          paths: { "@alias/*": ["lib/*"] },
        },
      }),
      "a.ts": 'import "@alias/gone";\n',
    });

    expect(doc.edges).toEqual([]);
    expect(doc.foreign).toEqual([]);
  });

  it("gives no edge to a skipped project file", () => {
    const doc = scanTree({
      "tsconfig.json": BUNDLER,
      "a.ts": 'import "./b.test";\nimport "./g";\n',
      "b.test.ts": x,
      "g.d.ts": "declare const g: number;\n",
    });

    expect(doc.edges).toEqual([]);
    expect(doc.foreign).toEqual([]);
  });
});

describe("foreign names", () => {
  it("drops subpaths and keeps scope and node prefix", () => {
    const doc = scanTree({
      "a.ts": [
        'import "@tauri-apps/api/core";',
        'import "lodash/fp";',
        'import "node:fs/promises";',
        'import "fs";',
        "",
      ].join("\n"),
    });

    expect(doc.foreign.map((f) => f.name)).toEqual([
      "@tauri-apps/api",
      "fs",
      "lodash",
      "node:fs",
    ]);
  });
});

describe("assets", () => {
  it("gives no edge and no node", () => {
    const doc = scanTree({
      "a.ts": [
        'import "./a.css";',
        'import "./b.svg?url";',
        'import "./c.json";',
        'import "katex/dist/katex.min.css";',
        'import "./d.png";',
        "",
      ].join("\n"),
    });

    expect(doc.edges).toEqual([]);
    expect(doc.foreign).toEqual([]);
  });
});
