import { describe, expect, it } from "vitest";
import { unpublishedValues } from "../../src/index.js";

const KEYS = [
  { key: "tests.<name>.language", values: ["python", "typescript"] },
  { key: "tests.<name>.runner", values: ["vitest", "jest"] },
  { key: "tests.<name>.coverage.format", values: ["lcov", "jacoco"] },
];

function suite(
  name: string,
  language: string,
  format: string,
  runner?: string,
) {
  return {
    name,
    language,
    directory: ".",
    command: "x",
    coverage: { path: "c", format },
    ...(runner === undefined ? {} : { runner }),
  };
}

describe("unpublishedValues", () => {
  it("gives no message when every value is published", () => {
    expect(
      unpublishedValues(
        { tests: [suite("web", "typescript", "lcov", "jest")] },
        KEYS,
      ),
    ).toEqual([]);
  });

  it("gives one message per refused value when none is published", () => {
    const messages = unpublishedValues(
      { tests: [suite("odd", "zig", "tap", "mocha")] },
      KEYS,
    );

    expect(messages).toEqual([
      "config/tests/0/language zig is not allowed; allowed values: python, typescript (suite odd)",
      "config/tests/0/runner mocha is not allowed; allowed values: vitest, jest (suite odd)",
      "config/tests/0/coverage/format tap is not allowed; allowed values: lcov, jacoco (suite odd)",
    ]);
  });

  it("names only the bad suite and value in a mixed document", () => {
    const messages = unpublishedValues(
      {
        tests: [
          suite("good", "python", "lcov"),
          suite("bad", "python", "tap"),
          suite("fine", "typescript", "jacoco", "vitest"),
        ],
      },
      KEYS,
    );

    expect(messages).toEqual([
      "config/tests/1/coverage/format tap is not allowed; allowed values: lcov, jacoco (suite bad)",
    ]);
  });

  it("checks nothing for a key no sensor publishes", () => {
    expect(
      unpublishedValues({ tests: [suite("odd", "zig", "tap", "mocha")] }, []),
    ).toEqual([]);
    expect(
      unpublishedValues(
        { tests: [suite("odd", "zig", "tap")] },
        KEYS.filter((one) => one.key.endsWith("language")),
      ),
    ).toHaveLength(1);
  });

  it("ignores a document with no tests", () => {
    expect(unpublishedValues({}, KEYS)).toEqual([]);
    expect(unpublishedValues(null, KEYS)).toEqual([]);
  });
});
