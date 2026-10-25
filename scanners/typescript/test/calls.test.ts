import { describe, expect, it } from "vitest";
import { BUNDLER, scanTree } from "./helpers.js";

const calls = (files: Record<string, string>, symlinks = {}) =>
  scanTree(files, symlinks).calls.map((c) => `${c.from} -> ${c.to} ${c.how}`);

describe("calls", () => {
  it("records a direct call and a construct", () => {
    expect(
      calls({
        "a.ts": "export function f() {}\nexport class C {}\n",
        "b.ts":
          'import { f, C } from "./a";\nexport function g() {\n  f();\n  new C();\n}\n',
      }),
    ).toEqual(["b.ts::g -> a.ts::f call", "b.ts::g -> a.ts::C construct"]);
  });

  it("follows a call through a re-export", () => {
    expect(
      calls({
        "impl.ts": "export function f() {}\n",
        "index.ts": 'export * from "./impl";\n',
        "use.ts":
          'import { f } from "./index";\nexport function g() { f(); }\n',
      }),
    ).toEqual(["use.ts::g -> impl.ts::f call"]);
  });

  it("resolves through a tsconfig paths import", () => {
    expect(
      calls({
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            module: "ESNext",
            moduleResolution: "Bundler",
            baseUrl: ".",
            paths: { "@lib/*": ["lib/*"] },
          },
        }),
        "lib/x.ts": "export function f() {}\n",
        "use.ts": 'import { f } from "@lib/x";\nexport function g() { f(); }\n',
      }),
    ).toEqual(["use.ts::g -> lib/x.ts::f call"]);
  });

  it("resolves through a workspace package import", () => {
    expect(
      calls({
        "package.json": '{"workspaces":["packages/*"]}',
        "tsconfig.json": BUNDLER,
        "packages/pkg/package.json": '{"name":"@w/pkg"}',
        "packages/pkg/src/index.ts": "export function f() {}\n",
        "packages/app/package.json": '{"name":"@w/app"}',
        "packages/app/src/a.ts":
          'import { f } from "@w/pkg";\nexport function g() { f(); }\n',
      }),
    ).toEqual([
      "packages/app/src/a.ts::g -> packages/pkg/src/index.ts::f call",
    ]);
  });

  it("records a method call on a typed receiver and this", () => {
    expect(
      calls({
        "a.ts":
          "export class C {\n  m() {}\n  private p() {}\n  go() { this.p(); }\n}\n",
        "b.ts":
          'import { C } from "./a";\nexport function g(c: C) { c.m(); const d = new C(); d.m(); }\n',
      }),
    ).toEqual([
      "a.ts::C.go -> a.ts::C.p call",
      "b.ts::g -> a.ts::C construct",
      "b.ts::g -> a.ts::C.m call",
    ]);
  });

  it("records an inferred call on an untyped parameter", () => {
    expect(
      calls({
        "ports.ts": "export interface Store { save(item: string): void; }\n",
        "use.ts": "export function place(store, id) {\n  store.save(id);\n}\n",
      }),
    ).toEqual(["use.ts::place -> ports.ts::Store.save inferred"]);
  });

  it("records an inferred call on a stored untyped constructor parameter", () => {
    expect(
      calls({
        "ports.ts": "export interface Store { fetch(item: string): void; }\n",
        "use.ts":
          "export class U {\n  constructor(private store) {}\n  go() { this.store.fetch('a'); }\n}\n",
      }),
    ).toEqual(["use.ts::U.go -> ports.ts::Store.fetch inferred"]);
  });

  it("dispatches from an interface method to an implementing class", () => {
    expect(
      calls({
        "ports.ts": "export interface Store { save(): void; }\n",
        "impl.ts":
          'import type { Store } from "./ports";\nexport class M implements Store { save() {} }\n',
      }),
    ).toEqual(["ports.ts::Store.save -> impl.ts::M.save dispatch"]);
  });

  it("dispatches from an abstract method, reaching a deeper definition but skipping inheritors", () => {
    expect(
      calls({
        "base.ts": "export abstract class B { abstract run(): void; }\n",
        "mid.ts":
          'import { B } from "./base";\nexport abstract class M extends B {}\n',
        "leaf.ts":
          'import { M } from "./mid";\nexport class L extends M { run() {} }\nexport class K extends M {}\n',
      }),
    ).toEqual(["base.ts::B.run -> leaf.ts::L.run dispatch"]);
  });

  it("drops calls into node_modules, lib and unresolved modules", () => {
    expect(
      calls({
        "a.ts":
          'import { join } from "node:path";\nimport { x } from "lodash";\nexport function g() { join("a"); x(); [1].map(String); }\n',
      }),
    ).toEqual([]);
  });

  it("records only the resolvable call in a function with an unresolvable one", () => {
    expect(
      calls({
        "a.ts":
          "export function f() {}\nexport function g(x) { x.unknown(); f(); }\n",
      }),
    ).toEqual(["a.ts::g -> a.ts::f call"]);
  });

  it("does not record super calls, module-level calls or class-body initialisers", () => {
    expect(
      calls({
        "a.ts": [
          "export function t() {}",
          "t();",
          "export class B { m() {} }",
          "export class C extends B {",
          "  x = t();",
          "  m() { super.m(); }",
          "}",
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  it("attributes calls in nested functions to the enclosing member", () => {
    expect(
      calls({
        "a.ts":
          "export function t() {}\nexport function f() {\n  const inner = () => t();\n  return inner;\n}\n",
      }),
    ).toEqual(["a.ts::f -> a.ts::t call"]);
  });

  it("is sorted and deduplicated", () => {
    const list = scanTree({
      "a.ts":
        "export function a() {}\nexport function b() {}\nexport function z() {\n  b(); b();\n  a();\n}\n",
    }).calls.map((c) => [c.to, c.line]);

    expect(list).toEqual([
      ["a.ts::b", 4],
      ["a.ts::a", 5],
    ]);
  });

  it("emits an empty calls list when nothing calls anything", () => {
    expect(scanTree({ "a.ts": "export const x = 1;\n" }).calls).toEqual([]);
  });
});
