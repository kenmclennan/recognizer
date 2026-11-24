import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readConfigArea } from "../src/adapters/plugins/repository-checks-adapter.js";
import { REPO } from "./helpers.js";

const KEYS = [
  { key: "tests.<name>.language", values: ["python", "typescript"] },
  { key: "tests.<name>.runner", values: ["vitest", "jest"] },
  { key: "tests.<name>.coverage.format", values: ["lcov", "jacoco"] },
];

const example = (name: string) =>
  readFileSync(join(REPO, "schema/config-examples/unpublished", name), "utf8");

function problemsOf(
  configText: string,
  keys: { key: string; values: string[] }[],
) {
  return readConfigArea(
    {
      repository: "/repo",
      named: false,
      configText,
      policyText: null,
      languages: [],
      scans: () => ({ state: "missing" }),
    },
    [],
    () => keys,
  ).problems;
}

describe("the doctor's config check against published values", () => {
  it("gives a coverage format no sensor publishes one config-invalid problem", () => {
    const problems = problemsOf(
      example("tests-bad-coverage-format.yaml"),
      KEYS,
    );

    expect(problems.map((problem) => problem.code)).toEqual(["config-invalid"]);
    expect(problems[0]?.line).toBe(
      "config/tests/0/coverage/format cobertura is not allowed; allowed values: lcov, jacoco (suite api)",
    );
  });

  it("gives a language no sensor publishes one config-invalid problem", () => {
    const problems = problemsOf(example("tests-unknown-language.yaml"), KEYS);

    expect(problems.map((problem) => problem.code)).toEqual(["config-invalid"]);
    expect(problems[0]?.subject).toBe("tests.0.language");
  });

  it("gives no problem for the same file when a sensor publishes the format", () => {
    const published = KEYS.map((one) =>
      one.key.endsWith("coverage.format")
        ? { ...one, values: [...one.values, "cobertura"] }
        : one,
    );

    expect(
      problemsOf(example("tests-bad-coverage-format.yaml"), published),
    ).toEqual([]);
  });

  it("checks nothing for a key no sensor publishes", () => {
    expect(problemsOf(example("tests-bad-coverage-format.yaml"), [])).toEqual(
      [],
    );
  });
});
