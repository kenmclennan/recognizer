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

describe("a set key its published schema marks retired", () => {
  const keys = [
    { key: "sensors.<name>.overlay", retired: "it has no effect now" },
    { key: "sensors.<name>.threshold" },
  ];

  it("is reported with its key, the reason and the command that removes it", () => {
    const problems = readConfigArea(
      {
        repository: "/repo",
        named: false,
        configText: "sensors:\n  crap:\n    overlay: x.json\n",
        policyText: null,
        languages: [],
        scans: () => ({ state: "missing" }),
      },
      () => keys,
    ).problems.filter((problem) => problem.code === "config-retired");

    expect(problems).toEqual([
      {
        code: "config-retired",
        subject: "sensors.crap.overlay",
        line: "config/sensors/crap/overlay is retired: it has no effect now",
        fix: {
          text: "recognizer config --unset sensors.crap.overlay",
          command: "recognizer config --unset sensors.crap.overlay",
        },
      },
    ]);
  });

  it("reports nothing when the key is not set", () => {
    const problems = readConfigArea(
      {
        repository: "/repo",
        named: false,
        configText: "sensors:\n  crap:\n    threshold: 3\n",
        policyText: null,
        languages: [],
        scans: () => ({ state: "missing" }),
      },
      () => keys,
    ).problems.filter((problem) => problem.code === "config-retired");

    expect(problems).toEqual([]);
  });
});
