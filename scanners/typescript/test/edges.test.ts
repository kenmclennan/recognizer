import { describe, expect, it } from "vitest";
import { BUNDLER, edgeList, scanTree } from "./helpers.js";

const x = "export const x = 1;\nexport type T = string;\n";

describe("import forms", () => {
  it("records every import form with its line", () => {
    const doc = scanTree({
      "tsconfig.json": BUNDLER,
      "t.ts": x,
      "a.ts": [
        'import type { T } from "./t";',
        'import "./t";',
        'export * from "./t";',
        'export { x } from "./t";',
        'import q = require("./t");',
        "export function f() {",
        '  return import("./t");',
        "}",
        "{",
        '  require("./t");',
        "}",
        'export type Y = typeof import("./t");',
        "const tpl = import(`./t`);",
        "const name = './t';",
        "import(`./$" + "{name}`);",
        "import(name);",
        "",
      ].join("\n"),
    });

    expect(edgeList(doc, "a.ts")).toEqual(
      [1, 2, 3, 4, 5, 7, 10, 12, 13].map(
        (line) => `a.ts depends t.ts @${line}`,
      ),
    );
  });

  it("reports the first line of a multi-line import", () => {
    const doc = scanTree({
      "tsconfig.json": BUNDLER,
      "t.ts": x,
      "a.ts": 'import {\n  x,\n  type T,\n} from "./t";\n',
    });

    expect(edgeList(doc, "a.ts")).toEqual(["a.ts depends t.ts @1"]);
  });

  it("emits the same target twice for two lines and drops a self import", () => {
    const doc = scanTree({
      "tsconfig.json": BUNDLER,
      "t.ts": x,
      "a.ts": 'import "./t";\nimport "./t";\nimport "./a";\n',
    });

    expect(edgeList(doc, "a.ts")).toEqual([
      "a.ts depends t.ts @1",
      "a.ts depends t.ts @2",
    ]);
  });
});

describe("heritage", () => {
  const base = [
    "export class B {}",
    "export interface I {}",
    "export interface J {}",
    "export default class Foo {}",
    "",
  ].join("\n");

  const scanHeritage = (source: string, extra: Record<string, string> = {}) =>
    edgeList(
      scanTree({
        "tsconfig.json": BUNDLER,
        "b.ts": base,
        "a.ts": source,
        ...extra,
      }),
      "a.ts",
    ).filter((e) => e.includes("->"));

  it("records extends and implements, together, ordered by to_member", () => {
    expect(
      scanHeritage(
        'import { B, J, I } from "./b";\nexport class C extends B implements J, I {}\n',
      ),
    ).toEqual([
      "a.ts implements b.ts @2 C->I",
      "a.ts implements b.ts @2 C->J",
      "a.ts inherits b.ts @2 C->B",
    ]);
  });

  it("reports the exported name for an aliased import", () => {
    expect(
      scanHeritage('import { B as Z } from "./b";\nclass C extends Z {}\n'),
    ).toEqual(["a.ts inherits b.ts @2 C->B"]);
  });

  it("reports the default member name for a default import", () => {
    expect(
      scanHeritage('import F from "./b";\nclass C extends F {}\n'),
    ).toEqual(["a.ts inherits b.ts @2 C->Foo"]);
    expect(
      scanHeritage('import F from "./b";\nclass C extends F {}\n', {
        "b.ts": "export default class extends Object {}\n",
      }),
    ).toEqual(["a.ts inherits b.ts @2 C->default"]);
  });

  it("reads a namespace import's property, one level only", () => {
    expect(
      scanHeritage('import * as ns from "./b";\nclass C extends ns.B {}\n'),
    ).toEqual(["a.ts inherits b.ts @2 C->B"]);
    expect(
      scanHeritage('import * as ns from "./b";\nclass C extends ns.A.B {}\n'),
    ).toEqual([]);
  });

  it("unwraps type arguments and ignores call expressions", () => {
    expect(
      scanHeritage('import { B } from "./b";\nclass C extends B<string> {}\n'),
    ).toEqual(["a.ts inherits b.ts @2 C->B"]);
    expect(
      scanHeritage(
        'import { B } from "./b";\ndeclare function mixin(b: unknown): any;\nclass C extends mixin(B) {}\n',
      ),
    ).toEqual([]);
  });

  it("gives no heritage edge for same-module, foreign or required bases", () => {
    expect(
      scanHeritage(
        "class A {}\nclass C extends A {}\nclass E extends Error {}\n",
      ),
    ).toEqual([]);
    expect(
      scanHeritage('const { B } = require("./b");\nclass C extends B {}\n'),
    ).toEqual([]);
  });

  it("points at the barrel for a base imported through it", () => {
    expect(
      scanHeritage('import { B } from "./barrel";\nclass C extends B {}\n', {
        "barrel.ts": 'export { B } from "./b";\n',
      }),
    ).toEqual(["a.ts inherits barrel.ts @2 C->B"]);
  });

  it("gives only depends for a function typed with an imported class and interface extends", () => {
    const edges = edgeList(
      scanTree({
        "tsconfig.json": BUNDLER,
        "b.ts": base,
        "a.ts":
          'import { B, I } from "./b";\nexport function f(b: B) {}\nexport interface X extends I {}\n',
      }),
      "a.ts",
    );

    expect(edges).toEqual(["a.ts depends b.ts @1"]);
  });

  it("uses default as the member of an anonymous default class", () => {
    expect(
      scanHeritage(
        'import { B } from "./b";\nexport default class extends B {}\n',
      ),
    ).toEqual(["a.ts inherits b.ts @2 default->B"]);
  });

  it("keeps the depends edge beside a heritage edge", () => {
    expect(
      edgeList(
        scanTree({
          "tsconfig.json": BUNDLER,
          "b.ts": base,
          "a.ts": 'import { B } from "./b";\nclass C extends B {}\n',
        }),
        "a.ts",
      ),
    ).toEqual(["a.ts depends b.ts @1", "a.ts inherits b.ts @2 C->B"]);
  });
});
