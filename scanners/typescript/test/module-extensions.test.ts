import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scan } from "../src/index.js";
import { FIXTURE, scanTree } from "./helpers.js";

const NODENEXT = JSON.stringify({
  compilerOptions: { module: "nodenext", moduleResolution: "nodenext" },
});

function dependsEdges(doc: ReturnType<typeof scan>): string[] {
  return doc.edges
    .filter((edge) => edge.kind === "depends")
    .map((edge) => `${edge.from} -> ${edge.to}`)
    .sort();
}

describe("module extensions fixture", () => {
  const root = join(FIXTURE, "module-extensions");
  const expected = JSON.parse(
    readFileSync(join(root, "expected.json"), "utf8"),
  ) as { modules: string[]; edges: string[]; entry_points: string[] };
  const doc = scan(root, null);

  it("scans exactly the modules expected.json lists", () => {
    expect(doc.modules.map((module) => module.id)).toEqual(expected.modules);
  });

  it("resolves .mjs and .cjs specifiers and no extensionless one", () => {
    expect(dependsEdges(doc)).toEqual(expected.edges);
  });

  it("marks only the config module as an entry point", () => {
    expect(doc.modules.filter((m) => m.entry_point).map((m) => m.id)).toEqual(
      expected.entry_points,
    );
  });

  it("records .mts and .cts in the selection", () => {
    expect(doc.selection.extensions).toEqual(
      expect.arrayContaining([".mts", ".cts"]),
    );
    expect(doc.selection.skip_file_globs).toEqual(
      expect.arrayContaining(["*.d.mts", "*.d.cts"]),
    );
  });
});

describe("module extensions under nodenext", () => {
  it("resolves the same specifiers with a nodenext tsconfig", () => {
    const doc = scanTree({
      "tsconfig.json": NODENEXT,
      "a.mts":
        'import { b } from "./b.mjs";\nimport { c } from "./c.cjs";\nexport const a = b + c;\n',
      "b.mts": "export const b = 1;\n",
      "c.cts": "export const c = 2;\n",
      "e.ts": 'import { b } from "./b.mjs";\nexport const e = b;\n',
    });

    expect(dependsEdges(doc)).toEqual([
      "a.mts -> b.mts",
      "a.mts -> c.cts",
      "e.ts -> b.mts",
    ]);
  });
});
