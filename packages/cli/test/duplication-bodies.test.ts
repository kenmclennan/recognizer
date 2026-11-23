import { bodyOf, findFunctions, type Grammar } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { allParsers } from "./duplication-helpers.js";

async function bodies(
  grammar: Grammar,
  source: string,
): Promise<Record<string, boolean>> {
  const parsers = await allParsers();
  const tree = parsers.get(grammar)?.parse(source);
  const found = findFunctions(tree?.rootNode as never, grammar);

  return Object.fromEntries(
    found.map((one) => [one.qualified, bodyOf(one.node) !== null]),
  );
}

describe("bodyOf", () => {
  it("gives no body to a Kotlin interface, abstract, external or expect function and one to every other function", async () => {
    const kotlin = `interface Port {
    fun bare(a: Int): Int
    fun defaulted(a: Int): Int { return a }
}

abstract class Base {
    abstract fun missing(a: Int): Int
    fun present(a: Int): Int { return a }
}

external fun outside(a: Int): Int

expect fun promised(a: Int): Int

fun plain(a: Int): Int { return a }
`;
    const found = await bodies("kotlin", kotlin);

    expect(found["Port.bare"]).toBe(false);
    expect(found["Port.defaulted"]).toBe(true);
    expect(found["Base.missing"]).toBe(false);
    expect(found["Base.present"]).toBe(true);
    expect(found.outside).toBe(false);
    expect(found.promised).toBe(false);
    expect(found.plain).toBe(true);

    expect(await bodies("python", "def f(a):\n    return a\n")).toEqual({
      f: true,
    });
    expect(
      await bodies("typescript", "function f(a: number) { return a; }\n"),
    ).toEqual({ f: true });
    expect(await bodies("rust", "fn f(a: i32) -> i32 { a }\n")).toEqual({
      f: true,
    });
    expect(
      await bodies(
        "csharp",
        "class A { int F(int a) { return a; } int G(int a) => a; }\n",
      ),
    ).toEqual({ "A.F": true, "A.G": true });
  });

  it("bodiless forms in the other grammars are not functions", async () => {
    const typescript = await bodies(
      "typescript",
      `abstract class A {
  abstract m(a: number): number;
  n(a: number) { return a; }
}
interface T { d(a: number): number; }
declare function g(a: number): number;
function over(a: number): number;
function over(a: string): string;
function over(a: any) { return a; }
`,
    );

    expect(Object.values(typescript).every(Boolean)).toBe(true);
    expect(Object.keys(typescript)).toContain("A.n");
    expect(Object.keys(typescript)).not.toContain("A.m");
    expect(Object.keys(typescript)).not.toContain("T.d");
    expect(Object.keys(typescript)).not.toContain("g");

    const rust = await bodies(
      "rust",
      `trait T { fn d(&self) -> i32; }
extern "C" { fn e(a: i32) -> i32; }
fn h(a: i32) -> i32 { a }
`,
    );

    expect(Object.keys(rust)).toEqual(["h"]);

    const csharp = await bodies(
      "csharp",
      `interface I { int D(int a); }
abstract class A {
  public abstract int M(int a);
  [System.Runtime.InteropServices.DllImport("x")] static extern int E(int a);
  partial void P(int a);
  public int Q(int a) { return a; }
}
`,
    );

    expect(Object.keys(csharp)).toEqual(["A.Q"]);
  });
});
