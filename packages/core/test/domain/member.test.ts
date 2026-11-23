import { describe, expect, it } from "vitest";
import { InvalidEntity, Member } from "../../src/index.js";

describe("Member", () => {
  it("finds a method and a field by name", () => {
    const member = new Member({
      name: "C",
      exported: true,
      methods: [{ name: "m" }],
      fields: [{ name: "x", line: 1, private: false }],
    });

    expect(member.method("m")?.name).toBe("m");
    expect(member.field("x")?.name).toBe("x");
    expect(member.method("x")).toBeUndefined();
    expect(member.field("m")).toBeUndefined();
  });

  it("holds no key it was not given", () => {
    expect(Object.keys(new Member({ name: "f", exported: true }))).toEqual([
      "name",
      "exported",
    ]);
  });

  it("refuses an empty name", () => {
    expect(() => new Member({ name: "", exported: true })).toThrow(
      InvalidEntity,
    );
  });
});
