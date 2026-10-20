import { describe, expect, it } from "vitest";
import { BUNDLER, edgeList, makeTree, runBin, scanTree } from "./helpers.js";

const alias = (target: string) =>
  JSON.stringify({
    compilerOptions: {
      module: "ESNext",
      moduleResolution: "Bundler",
      baseUrl: ".",
      paths: { "@x/*": [target] },
    },
    include: ["src"],
  });

const target = "export const t = 1;\n";
const user = 'import { t } from "@x/t";\nconsole.log(t);\n';

describe("tsconfig selection", () => {
  it("uses the nearest config for each file", () => {
    const doc = scanTree({
      "a/tsconfig.json": alias("src/lib/*"),
      "a/src/lib/t.ts": target,
      "a/src/use.ts": user,
      "b/tsconfig.json": alias("src/other/*"),
      "b/src/other/t.ts": target,
      "b/src/use.ts": user,
    });

    expect(edgeList(doc, "a/src/use.ts")).toEqual([
      "a/src/use.ts depends a/src/lib/t.ts @1",
    ]);
    expect(edgeList(doc, "b/src/use.ts")).toEqual([
      "b/src/use.ts depends b/src/other/t.ts @1",
    ]);
  });

  const solution = {
    "web/tsconfig.json": JSON.stringify({
      files: [],
      references: [
        { path: "./tsconfig.app.json" },
        { path: "./tsconfig.node.json" },
      ],
    }),
    "web/tsconfig.app.json": JSON.stringify({
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "Bundler",
        baseUrl: ".",
        paths: { "@a/*": ["src/a/*"] },
      },
      include: ["src"],
    }),
    "web/tsconfig.node.json": JSON.stringify({
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "Bundler",
        baseUrl: ".",
        paths: { "@n/*": ["node/*"] },
      },
      include: ["node"],
    }),
    "web/src/a/t.ts": target,
    "web/node/t.ts": target,
  };

  it("follows solution-style references to the config that lists the file", () => {
    const doc = scanTree({
      ...solution,
      "web/node/use.ts": 'import { t } from "@n/t";\nconsole.log(t);\n',
      "web/src/use.ts": 'import { t } from "@a/t";\nconsole.log(t);\n',
    });

    expect(edgeList(doc, "web/node/use.ts")).toEqual([
      "web/node/use.ts depends web/node/t.ts @1",
    ]);
    expect(edgeList(doc, "web/src/use.ts")).toEqual([
      "web/src/use.ts depends web/src/a/t.ts @1",
    ]);
  });

  it("uses the first reference for a file no config lists", () => {
    const doc = scanTree({
      ...solution,
      "web/scripts/use.ts": 'import { t } from "@a/t";\nconsole.log(t);\n',
    });

    expect(edgeList(doc, "web/scripts/use.ts")).toEqual([
      "web/scripts/use.ts depends web/src/a/t.ts @1",
    ]);
  });

  it("uses a non-solution config's options for a file outside its include", () => {
    const doc = scanTree({
      "tsconfig.json": alias("src/lib/*"),
      "src/lib/t.ts": target,
      "scripts/x.ts": user,
    });

    expect(edgeList(doc, "scripts/x.ts")).toEqual([
      "scripts/x.ts depends src/lib/t.ts @1",
    ]);
  });

  it("resolves an extensionless relative import with no tsconfig", () => {
    const doc = scanTree({ "a.ts": 'import "./b";\n', "b.ts": target });

    expect(edgeList(doc)).toEqual(["a.ts depends b.ts @1"]);
  });

  it("follows an extends chain for paths", () => {
    const doc = scanTree({
      "base.json": JSON.stringify({
        compilerOptions: {
          module: "ESNext",
          moduleResolution: "Bundler",
          baseUrl: ".",
          paths: { "@x/*": ["src/lib/*"] },
        },
      }),
      "tsconfig.json": JSON.stringify({
        extends: "./base.json",
        include: ["src"],
      }),
      "src/lib/t.ts": target,
      "src/use.ts": user,
    });

    expect(edgeList(doc, "src/use.ts")).toEqual([
      "src/use.ts depends src/lib/t.ts @1",
    ]);
  });

  it("exits 2 naming the tsconfig when extends cannot be found", () => {
    const root = makeTree({
      "tsconfig.json": JSON.stringify({ extends: "./missing.json" }),
      "a.ts": target,
    });
    const result = runBin(root);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("tsconfig.json:0:");
  });

  it("does not fail on a config with no inputs", () => {
    const doc = scanTree({
      "tsconfig.json": JSON.stringify({ include: ["nothing"] }),
      "a.ts": target,
    });

    expect(doc.modules.map((m) => m.id)).toEqual(["a.ts"]);
  });

  it("keeps the bundler default for relative js specifiers", () => {
    const doc = scanTree({
      "tsconfig.json": BUNDLER,
      "a.ts": 'import "./b.js";\n',
      "b.ts": target,
    });

    expect(edgeList(doc)).toEqual(["a.ts depends b.ts @1"]);
  });
});
