import { describe, expect, it } from "vitest";
import type { ScanDocument } from "../src/index.js";
import { edgeList, makeTree, runBin, validate } from "./helpers.js";

const BROKEN = '{ "compilerOptions": {';
const VUE = JSON.stringify({ references: [{ path: "./tsconfig.app.json" }] });
const VUE_APP = JSON.stringify({ extends: "@vue/tsconfig/tsconfig.dom.json" });
const HEALTHY = JSON.stringify({ compilerOptions: { module: "ESNext" } });

function mixed(extra: Record<string, string> = {}) {
  return makeTree({
    "healthy/tsconfig.json": HEALTHY,
    "healthy/a.ts": 'import { b } from "./b";\nexport const a = b;\n',
    "healthy/b.ts": "export const b = 1;\n",
    "vue/tsconfig.json": VUE,
    "vue/tsconfig.app.json": VUE_APP,
    "vue/v.ts": "export const v = 1;\n",
    "broken/tsconfig.json": BROKEN,
    "broken/x.ts": "export const x = 1;\n",
    ...extra,
  });
}

function scanned(root: string) {
  const result = runBin(root);
  const doc = JSON.parse(result.stdout) as ScanDocument;

  return { result, doc };
}

describe("skipped projects", () => {
  it("scans the healthy project and names the two unreadable ones", () => {
    const { result, doc } = scanned(mixed());

    expect(result.status).toBe(0);
    validate(doc);
    expect(doc.selection.skip_paths).toEqual(["broken", "vue"]);
    expect(doc.modules.map((m) => m.id)).toEqual([
      "healthy/a.ts",
      "healthy/b.ts",
    ]);
    expect(edgeList(doc)).toEqual(["healthy/a.ts depends healthy/b.ts @1"]);
    expect(result.stderr).toContain(
      "skipped project broken: broken/tsconfig.json:",
    );
    expect(result.stderr).toContain(
      "skipped project vue: vue/tsconfig.app.json:",
    );
    expect(result.stderr).toContain("@vue/tsconfig/tsconfig.dom.json");
  });

  it("makes no edge or module for an import into a skipped directory", () => {
    const { result, doc } = scanned(
      mixed({
        "healthy/c.ts": 'import { v } from "../vue/v";\nexport const c = v;\n',
      }),
    );

    expect(result.status).toBe(0);
    expect(doc.selection.skip_paths).toContain("vue");
    expect(doc.modules.map((m) => m.id)).not.toContain("vue/v.ts");
    expect(doc.edges.filter((e) => e.from === "healthy/c.ts")).toEqual([]);
  });

  it("omits skip_paths when nothing is skipped", () => {
    const { doc } = scanned(
      makeTree({ "tsconfig.json": HEALTHY, "a.ts": "export const a = 1;\n" }),
    );

    expect(doc.selection.skip_paths).toBeUndefined();
  });

  it("skips everything when the root config fails", () => {
    const { result, doc } = scanned(
      makeTree({ "tsconfig.json": BROKEN, "a.ts": "export const a = 1;\n" }),
    );

    expect(result.status).toBe(0);
    expect(doc.selection.skip_paths).toEqual(["."]);
    expect(doc.modules).toEqual([]);
    expect(doc.files).toEqual([]);
  });

  it("skips a healthy project nested in a skipped directory", () => {
    const { result, doc } = scanned(
      makeTree({
        "app/tsconfig.json": BROKEN,
        "app/a.ts": "export const a = 1;\n",
        "app/inner/tsconfig.json": HEALTHY,
        "app/inner/i.ts": "export const i = 1;\n",
      }),
    );

    expect(result.status).toBe(0);
    expect(doc.selection.skip_paths).toEqual(["app"]);
    expect(doc.modules).toEqual([]);
    expect(result.stderr).toContain(
      "skipped project app/inner: inside skipped project app",
    );
  });

  it("ignores a syntax error in a file under a skipped directory", () => {
    const { result } = scanned(
      mixed({ "broken/bad.ts": "export const = ;\n" }),
    );

    expect(result.status).toBe(0);
  });

  it("still exits 2 for a syntax error in a healthy project", () => {
    const result = runBin(mixed({ "healthy/bad.ts": "export const = ;\n" }));

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
  });
});
