import { describe, expect, it } from "vitest";
import { compileGlob } from "../src/glob.js";

const cases: [string, string, boolean][] = [
  ["shop/domain/**", "shop/domain/order.py", true],
  ["shop/domain/**", "shop/domain", true],
  ["shop/domain/**", "shop/domainx/a.py", false],
  ["shop/adapters/*", "shop/adapters/a.py", true],
  ["shop/adapters/*", "shop/adapters/x/a.py", false],
  ["**/fixtures/**", "fixtures/a.py", true],
  ["**/fixtures/**", "a/b/fixtures/c.py", true],
  ["**/fixtures/**", "a/xfixtures/c.py", false],
  ["tests/**", "tests/a.py", true],
  ["*", "shop/a.py", true],
  ["*", "foreign:requests", true],
  ["foreign:requests", "foreign:requests", true],
  ["shop/main.py", "shop/mainxpy", false],
  ["a.b", "aXb", false],
  ["**/*_test.py", "shop/order_test.py", true],
  ["**/*_test.py", "order_test.py", true],
];

describe("glob", () => {
  it.each(cases)("%s against %s is %s", (pattern, id, expected) => {
    expect(compileGlob(pattern)(id)).toBe(expected);
  });

  it("matches a single character with ? but never a slash", () => {
    expect(compileGlob("a?c")("abc")).toBe(true);
    expect(compileGlob("a?c")("a/c")).toBe(false);
  });
});
