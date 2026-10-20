import { describe, expect, it } from "vitest";
import { scanTree } from "./helpers.js";

const members = (source: string, name = "a.ts") => {
  const doc = scanTree({ [name]: source });
  const module = doc.modules[0];

  return {
    kind: module?.kind,
    members: module?.members.map(
      (m) => `${m.name}:${m.kind}:${m.line}:${m.exported}`,
    ),
  };
};

describe("members", () => {
  it("covers each declaration form", () => {
    expect(
      members(
        [
          "export class A {}",
          "abstract class B {}",
          "export async function f() {}",
          "function* g() {}",
          "declare function h(): void;",
          "export const arrow = () => 1;",
          "const fexpr = function () {};",
          "const klass = class {};",
          "let n = 1, m = 2;",
          "var { p, q: [r] } = obj;",
          "interface I {}",
          "type T = string;",
          "const enum E { A }",
          "declare enum D { A }",
          "",
        ].join("\n"),
      ).members,
    ).toEqual([
      "A:class:1:true",
      "B:class:2:false",
      "f:function:3:true",
      "g:function:4:false",
      "h:function:5:false",
      "arrow:function:6:true",
      "fexpr:function:7:false",
      "klass:constant:8:false",
      "n:constant:9:false",
      "m:constant:9:false",
      "p:constant:10:false",
      "r:constant:10:false",
      "I:interface:11:false",
      "T:type:12:false",
      "E:type:13:false",
      "D:type:14:false",
    ]);
  });

  it("collapses overloads", () => {
    expect(
      members(
        "export function f(a: string): void;\nexport function f(a: number): void;\nexport function f(a: any) {}\n",
      ).members,
    ).toEqual(["f:function:1:true"]);
  });

  it("handles default exports", () => {
    expect(members("export default function () {}\n").members).toEqual([
      "default:function:1:true",
    ]);
    expect(members("\nexport default {};\n").members).toEqual([
      "default:constant:2:true",
    ]);
    expect(members("export default () => 1;\n").members).toEqual([
      "default:function:1:true",
    ]);
    expect(members("class Name {}\nexport default Name;\n").members).toEqual([
      "Name:class:1:true",
    ]);
  });

  it("marks local declarations exported by a clause", () => {
    expect(
      members("const a = 1;\nconst b = 2;\nexport { a as c };\n").members,
    ).toEqual(["a:constant:1:true", "b:constant:2:false"]);
  });

  it("reports the name's line for decorated and multi-line declarations", () => {
    expect(members("@dec()\nexport\nclass Foo {}\n").members).toEqual([
      "Foo:class:3:true",
    ]);
  });

  it("ignores nested declarations, namespaces and non-declarations", () => {
    expect(
      members(
        [
          "if (true) { const inner = 1; }",
          "namespace N { export const z = 1; }",
          "declare global { interface W {} }",
          "export = something;",
          "console.log(1);",
          'export * from "./x";',
          "",
        ].join("\n"),
      ).members,
    ).toEqual([]);
  });

  it("does not recognise CommonJS exports", () => {
    expect(
      members("const util = {};\nmodule.exports = util;\n", "a.js").members,
    ).toEqual(["util:constant:1:false"]);
  });
});

describe("module kind", () => {
  it("is interface for only interface and type exports", () => {
    expect(
      members("export interface I {}\nexport type T = string;\n").kind,
    ).toBe("interface");
  });

  it("is module when an exported const sits beside an interface", () => {
    expect(members("export interface I {}\nexport const c = 1;\n").kind).toBe(
      "module",
    );
  });

  it("ignores unexported members", () => {
    expect(members("export interface I {}\nconst c = 1;\n").kind).toBe(
      "interface",
    );
  });

  it("is module for an enum-only, empty or re-export-only module", () => {
    expect(members("export enum E { A }\n").kind).toBe("module");
    expect(members("const c = 1;\n").kind).toBe("module");
    expect(members('export * from "./x";\n').kind).toBe("module");
  });

  it("is interface for exactly one exported type alias", () => {
    expect(members("export type T = string;\n").kind).toBe("interface");
  });
});
