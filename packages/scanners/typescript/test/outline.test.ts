import { describe, expect, it } from "vitest";
import { scanTree } from "./helpers.js";

const member = (source: string, name: string, file = "a.ts") => {
  const doc = scanTree({ [file]: source });
  const found = doc.modules[0]?.members.find((m) => m.name === name);

  if (!found) {
    throw new Error(`no member ${name}`);
  }

  return found;
};

const method = (source: string, cls: string, name: string) => {
  const found = member(source, cls).methods?.find((m) => m.name === name);

  if (!found) {
    throw new Error(`no method ${name}`);
  }

  return found;
};

describe("outline: bases", () => {
  it("lists extends then implements as written", () => {
    expect(
      member(
        "interface I {}\ninterface J<T> {}\nclass B {}\nclass A implements I, J<string> extends B {}\n",
        "A",
      ).bases,
    ).toEqual(["B", "I", "J<string>"]);
  });

  it("uses an interface's extends list", () => {
    expect(
      member("interface P {}\ninterface Q extends P {}\n", "Q").bases,
    ).toEqual(["P"]);
  });

  it("is empty for a class without heritage", () => {
    expect(member("class A {}\n", "A").bases).toEqual([]);
  });
});

describe("outline: fields", () => {
  it("lists properties, parameter properties and interface properties", () => {
    expect(
      member(
        [
          "class A {",
          "  x: number = 1;",
          "  y = 2;",
          "  #z: string;",
          "  private p?: boolean;",
          "  constructor(public a: string, private b, c: number) {}",
          "}",
        ].join("\n"),
        "A",
      ).fields,
    ).toEqual([
      { name: "x", type: "number", line: 2, private: false },
      { name: "y", line: 3, private: false },
      { name: "#z", type: "string", line: 4, private: true },
      { name: "p", type: "boolean", line: 5, private: true },
      { name: "a", type: "string", line: 6, private: false },
      { name: "b", line: 6, private: true },
    ]);
    expect(
      member("interface I { a: string; b?: number }\n", "I").fields,
    ).toEqual([
      { name: "a", type: "string", line: 1, private: false },
      { name: "b", type: "number", line: 1, private: false },
    ]);
  });

  it("counts protected and a private parameter property as private", () => {
    expect(
      member(
        [
          "class A {",
          "  protected q = 1;",
          "  constructor(",
          "    private readonly store: Store,",
          "  ) {}",
          "}",
        ].join("\n"),
        "A",
      ).fields,
    ).toEqual([
      { name: "q", line: 2, private: true },
      { name: "store", type: "Store", line: 4, private: true },
    ]);
  });
});

describe("outline: parameters and returns", () => {
  it("drops this and keeps rest and destructured parameters", () => {
    expect(
      member(
        "function f(this: Window, a, ...rest: number[]) {}\nfunction g({ a,\n b }, [c]: number[]) {}\n",
        "f",
      ).params,
    ).toEqual([{ name: "a" }, { name: "rest", type: "number[]" }]);
    expect(
      member("function g({ a,\n b }, [c]: number[]) {}\n", "g").params,
    ).toEqual([{ name: "{ a, b }" }, { name: "[c]", type: "number[]" }]);
  });

  it("types a parameter only by its declaration, not by inference", () => {
    expect(
      method("class A { m(a: Map<string,\n number>, b = 1) {} }\n", "A", "m")
        .params,
    ).toEqual([{ name: "a", type: "Map<string, number>" }, { name: "b" }]);
  });

  it("emits returns only when declared", () => {
    expect(member("function f(): Promise<\n  void\n> {}\n", "f").returns).toBe(
      "Promise< void >",
    );
    expect(member("function g() { return 1; }\n", "g").returns).toBeUndefined();
    expect(
      method("class A { m(): number { return 1; } n() {} }\n", "A", "m")
        .returns,
    ).toBe("number");
    expect(
      method("class A { m(): number { return 1; } n() {} }\n", "A", "n")
        .returns,
    ).toBeUndefined();
  });

  it("outlines arrow functions assigned to constants", () => {
    const found = member(
      "export const f = async (a: number): string => '';\n",
      "f",
    );

    expect(found.kind).toBe("function");
    expect(found.params).toEqual([{ name: "a", type: "number" }]);
    expect(found.returns).toBe("string");
    expect(found.tags).toEqual(["async"]);
  });
});

describe("outline: private", () => {
  it("is true for private, protected and # names", () => {
    const source = [
      "class A {",
      "  a() {}",
      "  private b() {}",
      "  protected c() {}",
      "  #d() {}",
      "}",
    ].join("\n");

    expect(
      member(source, "A").methods?.map((m) => [m.name, m.private]),
    ).toEqual([
      ["a", false],
      ["b", true],
      ["c", true],
      ["#d", true],
    ]);
  });
});

describe("outline: tags", () => {
  it("tags property, static, abstract and async", () => {
    const source = [
      "abstract class A {",
      "  get p(): number { return 1; }",
      "  set p(v: number) {}",
      "  static s() {}",
      "  abstract a(): void;",
      "  async b() {}",
      "  static async c() {}",
      "  plain() {}",
      "}",
    ].join("\n");

    expect(member(source, "A").methods?.map((m) => [m.name, m.tags])).toEqual([
      ["p", ["property"]],
      ["s", ["static"]],
      ["a", ["abstract"]],
      ["b", ["async"]],
      ["c", ["static", "async"]],
      ["plain", undefined],
    ]);
  });

  it("tags every interface method signature abstract", () => {
    expect(method("interface I { save(): void }\n", "I", "save").tags).toEqual([
      "abstract",
    ]);
  });
});

describe("outline: constant values", () => {
  it("keeps a 40 character value whole", () => {
    const text = `"${"x".repeat(38)}"`;

    expect(member(`const A = ${text};\n`, "A").value).toBe(text);
  });

  it("cuts a 41 character value to 39 plus an ellipsis", () => {
    const text = `"${"x".repeat(39)}"`;
    const value = member(`const A = ${text};\n`, "A").value;

    expect(value).toBe(`${text.slice(0, 39)}…`);
    expect(value).toHaveLength(40);
  });

  it("collapses whitespace runs", () => {
    expect(member("const A = [\n  1,\n  2,\n];\n", "A").value).toBe(
      "[ 1, 2, ]",
    );
  });
});

describe("outline: class tags", () => {
  it("tags an abstract class", () => {
    expect(member("abstract class A {}\n", "A").tags).toEqual(["abstract"]);
  });

  it("leaves a plain class, an interface and a type alias untagged", () => {
    const source = "class A {}\ninterface I {}\ntype T = { a: number };\n";

    for (const name of ["A", "I", "T"]) {
      expect(member(source, name)).not.toHaveProperty("tags");
    }
  });

  it("does not record decorators", () => {
    expect(
      member("function d(c: unknown) {}\n@d\nclass A {}\n", "A"),
    ).not.toHaveProperty("tags");
  });
});
