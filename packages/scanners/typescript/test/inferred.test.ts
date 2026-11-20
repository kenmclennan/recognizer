import { describe, expect, it } from "vitest";
import { scanTree } from "./helpers.js";

const STORE = `export interface Store { save(item: string): void; }
export class MemoryStore implements Store { save(item: string): void {} }
export class SpecialStore extends MemoryStore {}
`;

const inferred = (files: Record<string, string>, from = "use.ts") =>
  scanTree(files)
    .edges.filter((edge) => edge.from === from && edge.inferred)
    .map((edge) => ({
      to: edge.to,
      line: edge.line,
      names: edge.names,
      ...edge.inferred,
    }));

describe("inferred edges", () => {
  it("matches a single abstract class and lists its direct implementations", () => {
    expect(
      inferred({
        "ports.ts": STORE,
        "use.ts": "export function place(store, id) {\n  store.save(id);\n}\n",
      }),
    ).toEqual([
      {
        to: "ports.ts",
        line: 1,
        names: ["save"],
        parameter: "store",
        methods: ["save"],
        class: "Store",
        implementations: ["MemoryStore"],
      },
    ]);
  });

  it("prefers an abstract class over concrete ones", () => {
    const edges = inferred({
      "ports.ts": STORE,
      "other.ts": "export class Other { save() {} }\n",
      "use.ts": "export function go(x) { x.save(); }\n",
    });

    expect(edges.map((edge) => edge.class)).toEqual(["Store"]);
  });

  it("counts inherited methods", () => {
    const edges = inferred({
      "base.ts": "export class Base { save() {} }\n",
      "child.ts":
        'import { Base } from "./base";\nexport class Child extends Base { load2() {} }\n',
      "use.ts": "export function go(x) { x.save(); x.load2(); }\n",
    });

    expect(edges.map((edge) => edge.class)).toEqual(["Child"]);
  });

  it("emits four edges for four concrete matches and none for five", () => {
    const classes = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, i) => [
          `c${i}.ts`,
          `export class C${i} { save() {} }\n`,
        ]),
      );
    const use = { "use.ts": "export function go(x) { x.save(); }\n" };

    expect(inferred({ ...classes(4), ...use })).toHaveLength(4);
    expect(inferred({ ...classes(5), ...use })).toHaveLength(0);
  });

  it("emits nothing when every method is generic", () => {
    expect(
      inferred({
        "a.ts": "export class A { get() {} }\n",
        "use.ts": 'export function go(x) { return x.get("k"); }\n',
      }),
    ).toEqual([]);
  });

  it("still matches on both when only some methods are generic", () => {
    const edges = inferred({
      "a.ts": "export class A { get() {} save() {} }\n",
      "b.ts": "export class B { save() {} }\n",
      "use.ts": "export function go(x) { x.get(); x.save(); }\n",
    });

    expect(edges.map((edge) => edge.class)).toEqual(["A"]);
    expect(edges[0]?.names).toEqual(["get", "save"]);
  });

  it("follows a parameter stored on this and a parameter property", () => {
    const stored = inferred({
      "ports.ts": STORE,
      "use.ts":
        "export class S {\n  constructor(store) { this.s = store; }\n  run() { this.s.save('x'); }\n}\n",
    });
    const property = inferred({
      "ports.ts": STORE,
      "use.ts":
        "export class S {\n  constructor(private store) {}\n  run() { this.store?.save('x'); }\n}\n",
    });

    expect(stored.map((edge) => edge.class)).toEqual(["Store"]);
    expect(property.map((edge) => edge.class)).toEqual(["Store"]);
  });

  it("skips typed parameters", () => {
    expect(
      inferred({
        "ports.ts": STORE,
        "use.ts":
          "export function go(store: unknown) { (store as any).save(); store.save(); }\n",
      }),
    ).toEqual([]);
  });

  it("drops an edge that duplicates an import edge to the same module", () => {
    expect(
      inferred({
        "ports.ts": STORE,
        "use.ts":
          'import type { Store } from "./ports";\nexport function go(store) { store.save(); }\n',
      }),
    ).toEqual([]);
  });

  it("emits nothing for a parameter with no method calls", () => {
    expect(
      inferred({
        "ports.ts": STORE,
        "use.ts": "export function go(store) { return store; }\n",
      }),
    ).toEqual([]);
  });

  it("drops an edge into the importer's own module", () => {
    expect(
      inferred({ "use.ts": `${STORE}export function go(x) { x.save(); }\n` }),
    ).toEqual([]);
  });

  it("ignores rest parameters and destructured ones", () => {
    expect(
      inferred({
        "ports.ts": STORE,
        "use.ts": "export function go(...rest) { rest.save(); }\n",
      }),
    ).toEqual([]);
  });

  it("orders several edges from one line stably", () => {
    const files = {
      "b.ts": "export class B { save() {} }\n",
      "a.ts": "export class A { save() {} }\n",
      "use.ts": "export function go(x) { x.save(); }\n",
    };

    expect(inferred(files).map((edge) => edge.to)).toEqual(["a.ts", "b.ts"]);
  });
});
