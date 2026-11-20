import { describe, expect, it } from "vitest";
import {
  classHeritage,
  fieldTokens,
  memberHeadTokens,
  methodTokens,
  type Token,
  tokensText,
  typeAliasTokens,
} from "../src/index.js";
import type { ScanEdge, ScanMember } from "../src/scan.js";

const roles = (tokens: Token[]) =>
  tokens.map((token) => `${token.role}:${token.text}`);

const klass = (extra: Partial<ScanMember> = {}): ScanMember => ({
  name: "C",
  kind: "class",
  exported: true,
  ...extra,
});

const edge = (kind: ScanEdge["kind"], member: string, to: string): ScanEdge =>
  ({ from: "m", to: "n", kind, member, to_member: to }) as ScanEdge;

describe("member tokens", () => {
  it("colours a typed and an untyped parameter and the return type", () => {
    const tokens = methodTokens({
      name: "go",
      line: 1,
      private: false,
      params: [{ name: "a", type: "string" }, { name: "b" }],
      returns: "Order",
    });

    expect(roles(tokens)).toEqual([
      "name:go",
      "plain:(",
      "param:a",
      "plain:: ",
      "keyword:string",
      "plain:, ",
      "param:b",
      "plain:)",
      "plain: → ",
      "type:Order",
    ]);
  });

  it("writes a property as name: type and shows tags after a method", () => {
    expect(
      tokensText(
        methodTokens({
          name: "area",
          line: 1,
          private: false,
          returns: "float",
          tags: ["property"],
        }),
      ),
    ).toBe("area: float");
    expect(
      tokensText(
        methodTokens({
          name: "make",
          line: 1,
          private: false,
          params: [],
          tags: ["static", "async"],
        }),
      ),
    ).toBe("make() static async");
  });

  it("writes a field with and without a type", () => {
    expect(tokensText(fieldTokens({ name: "id", line: 1, type: "str" }))).toBe(
      "id: str",
    );
    expect(tokensText(fieldTokens({ name: "id", line: 1 }))).toBe("id");
  });

  it("writes a constant with a built-in and a plain value", () => {
    const built = memberHeadTokens(
      { name: "K", kind: "constant", exported: true, value: "null" },
      [],
    );
    const plain = memberHeadTokens(
      { name: "K", kind: "constant", exported: true, value: "100" },
      [],
    );

    expect(roles(built ?? [])).toEqual(["name:K", "plain: = ", "keyword:null"]);
    expect(roles(plain ?? [])).toEqual(["name:K", "plain: = ", "value:100"]);
  });

  it("writes a type alias and gives no head to a member without a kind", () => {
    expect(roles(typeAliasTokens("T"))).toEqual([
      "keyword:type",
      "plain: ",
      "name:T",
    ]);
    expect(memberHeadTokens({ name: "x", exported: true }, [])).toBeNull();
  });

  it("writes a class with an exception tag and extends", () => {
    const tokens = memberHeadTokens(klass({ bases: ["BaseError"] }), []);

    expect(tokensText(tokens ?? [])).toBe("class C BaseError");
  });

  it("writes an interface as abstract with an implements edge", () => {
    const tokens = memberHeadTokens(
      klass({ kind: "interface", bases: ["A"] }),
      [edge("implements", "C", "A")],
    );

    expect(tokensText(tokens ?? [])).toBe("interface C abstract implements A");
  });

  it("writes a class that is only abstract", () => {
    const tokens = memberHeadTokens(klass({ bases: ["ABC"] }), []);

    expect(tokensText(tokens ?? [])).toBe("class C abstract");
  });

  it("shows both implements and extends when edges resolve only some bases", () => {
    const heritage = classHeritage(klass({ bases: ["A", "B"] }), [
      edge("implements", "C", "A"),
    ]);

    expect(heritage.implemented).toEqual(["A"]);
    expect(heritage.inherited).toEqual(["B"]);
    expect(
      tokensText(
        memberHeadTokens(klass({ bases: ["A", "B"] }), [
          edge("implements", "C", "A"),
        ]) ?? [],
      ),
    ).toBe("class C implements A extends B");
  });

  it("joins tokens into text", () => {
    expect(
      tokensText([
        { text: "a", role: "name" },
        { text: ": ", role: "plain" },
      ]),
    ).toBe("a: ");
  });
});
