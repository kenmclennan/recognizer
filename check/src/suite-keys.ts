import type { KeyEntry, SectionEntry } from "./config-keys.js";

export const SUITE_SECTION: SectionEntry = {
  key: "tests.<name>",
  shape: "list-entry",
  identity: "name",
  description:
    "one test suite the coverage and mutation sensors run, found by its name; its first key creates it",
  example: 'tests.unit.command "pytest"',
};

export const SUITE_KEYS: KeyEntry[] = [
  {
    key: "tests.<name>.language",
    type: "enum",
    description:
      "the language of the suite, which decides how its coverage report is read",
    example: "tests.unit.language python",
    values: ["python", "typescript", "kotlin", "rust", "csharp"],
  },
  {
    key: "tests.<name>.directory",
    type: "path",
    description: "the folder the suite runs from, relative to the repository",
    example: "tests.unit.directory .",
  },
  {
    key: "tests.<name>.command",
    type: "string",
    description:
      "the command that runs the suite and writes its coverage report, run in the user's login shell",
    example:
      'tests.unit.command "pytest --cov=src --cov-report=lcov:.recognizer/cache/coverage/unit/lcov.info"',
  },
  {
    key: "tests.<name>.activate",
    type: "string",
    description:
      "a line that makes the suite's tools available in a fresh login shell, such as a virtual environment or a Node version manager",
    example: 'tests.unit.activate "source .venv/bin/activate"',
  },
  {
    key: "tests.<name>.runner",
    type: "enum",
    description:
      "the test runner of a typescript suite; no other language takes one",
    example: "tests.web.runner vitest",
    values: ["vitest", "jest"],
  },
  {
    key: "tests.<name>.env.<variable>",
    type: "string",
    description: "one environment variable the suite runs with",
    example: "tests.unit.env.PYTHONPATH src",
  },
  {
    key: "tests.<name>.coverage.path",
    type: "path",
    description:
      "the coverage report the suite writes, relative to the suite's directory; * matches a folder or file name",
    example:
      "tests.unit.coverage.path .recognizer/cache/coverage/unit/lcov.info",
  },
  {
    key: "tests.<name>.coverage.format",
    type: "enum",
    description: "the format of the coverage report the suite writes",
    example: "tests.unit.coverage.format lcov",
    values: ["lcov", "jacoco"],
  },
];
