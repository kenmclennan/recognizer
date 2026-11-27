import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CachedScansState,
  type PolicyParse,
  type PublishedValues,
  type RepositoryChecks,
  readConfigArea,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parsePolicy } from "../src/adapters/filesystem/policy-translator.js";
import { schemaMessages } from "../src/config-parse.js";
import { InputError } from "../src/errors.js";
import { REPO } from "./helpers.js";

const KEYS = [
  { key: "tests.<name>.language", values: ["python", "typescript"] },
  { key: "tests.<name>.runner", values: ["vitest", "jest"] },
  { key: "tests.<name>.coverage.format", values: ["lcov", "jacoco"] },
];

const example = (name: string) =>
  readFileSync(join(REPO, "schema/config-examples/unpublished", name), "utf8");

interface Context {
  repository: string;
  named: boolean;
  configText: string | null;
  policyText: string | null;
  languages: string[];
  scans(): CachedScansState;
}

function repositoryChecksOf(
  given: Context,
  keys: PublishedValues,
): RepositoryChecks {
  return {
    isDirectory: () => true,
    languages: () => given.languages,
    configDocument: () =>
      given.configText === null
        ? { kind: "absent" }
        : { kind: "parsed", document: parse(given.configText) ?? {} },
    configSchemaMessages: (document) => schemaMessages(document),
    publishedKeys: () => keys,
    policyFacts: () => {
      if (given.policyText === null) {
        return { kind: "absent" };
      }

      const text = given.policyText;
      const document: unknown = parse(text);

      return {
        kind: "read",
        keys:
          typeof document === "object" && document !== null
            ? Object.keys(document)
            : [],
        parsed: parsedPolicy(text),
      };
    },
    scansState: () => given.scans(),
    registeredSensors: () => [],
    suites: () => undefined,
  };
}

function parsedPolicy(text: string): PolicyParse {
  try {
    return { ok: true, rules: parsePolicy(text) };
  } catch (error) {
    return {
      ok: false,
      messages:
        error instanceof InputError
          ? error.messages
          : [(error as Error).message],
    };
  }
}

function problemsOf(configText: string, keys: PublishedValues) {
  return readConfigArea(
    repositoryChecksOf(
      {
        repository: "/repo",
        named: false,
        configText,
        policyText: null,
        languages: [],
        scans: () => ({ state: "missing" }),
      },
      keys,
    ),
    "/repo",
    false,
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
    const problems = problemsOf(
      "sensors:\n  crap:\n    overlay: x.json\n",
      keys,
    ).filter((problem) => problem.code === "config-retired");

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
    const problems = problemsOf(
      "sensors:\n  crap:\n    threshold: 3\n",
      keys,
    ).filter((problem) => problem.code === "config-retired");

    expect(problems).toEqual([]);
  });
});
