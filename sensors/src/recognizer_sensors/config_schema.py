import json

KEYS_VERSION = 1

PLACEHOLDERS = {
    "name": "^.+$",
    "variable": "^[A-Za-z_][A-Za-z0-9_]*$",
    "metric": "^(?!command$)[A-Za-z0-9_-]+$",
}

SECTIONS = (
    {
        "key": "tests.<name>",
        "shape": "list-entry",
        "identity": "name",
        "description": (
            "one test suite the coverage and mutation sensors run, found by its name; "
            "its first key creates it"
        ),
        "example": 'tests.unit.command "pytest"',
    },
)


def key(name, kind, description, example, **extra):
    return {"key": name, "type": kind, "description": description, "example": example, **extra}


TEST_KEYS = (
    key(
        "tests.<name>.language",
        "enum",
        "the language of the suite, which decides how its coverage report is read",
        "tests.unit.language python",
        values=["python", "typescript", "kotlin", "rust", "csharp"],
    ),
    key(
        "tests.<name>.directory",
        "path",
        "the folder the suite runs from, relative to the repository",
        "tests.unit.directory .",
    ),
    key(
        "tests.<name>.command",
        "string",
        (
            "the command that runs the suite and writes its coverage report, run in"
            " the user's login "
            "shell"
        ),
        (
            'tests.unit.command "pytest --cov=src '
            '--cov-report=lcov:.recognizer/cache/coverage/unit/lcov.info"'
        ),
    ),
    key(
        "tests.<name>.activate",
        "string",
        (
            "a line that makes the suite's tools available in a fresh login shell, "
            "such as a virtual "
            "environment or a Node version manager"
        ),
        'tests.unit.activate "source .venv/bin/activate"',
    ),
    key(
        "tests.<name>.runner",
        "enum",
        "the test runner of a typescript suite; no other language takes one",
        "tests.web.runner vitest",
        values=["vitest", "jest"],
    ),
    key(
        "tests.<name>.env.<variable>",
        "string",
        "one environment variable the suite runs with",
        "tests.unit.env.PYTHONPATH src",
    ),
    key(
        "tests.<name>.coverage.path",
        "path",
        (
            "the coverage report the suite writes, relative to the suite's directory; * matches a "
            "folder or file name"
        ),
        "tests.unit.coverage.path .recognizer/cache/coverage/unit/lcov.info",
    ),
    key(
        "tests.<name>.coverage.format",
        "enum",
        "the format of the coverage report the suite writes",
        "tests.unit.coverage.format lcov",
        values=["lcov", "jacoco"],
    ),
)

CRAP_KEYS = (
    key(
        "sensors.crap.threshold",
        "number",
        "the C.R.A.P. score above which a function is reported, above 0; default 30",
        "sensors.crap.threshold 20",
        exclusiveMinimum=0,
    ),
    key(
        "sensors.crap.overlay",
        "path",
        (
            "where the sensor writes its overlay, relative to the repository; default "
            ".recognizer/cache/overlays/crap.json"
        ),
        "sensors.crap.overlay .recognizer/cache/overlays/crap.json",
    ),
)

MUTATION_KEYS = (
    key(
        "sensors.mutation.carry",
        "string",
        (
            "untracked repository paths Mutation copies into its working copy, such as a virtual "
            "environment or node_modules"
        ),
        "--add sensors.mutation.carry .venv",
        multi=True,
    ),
    key(
        "sensors.mutation.max_minutes",
        "number",
        (
            "the time budget of a Mutation run in minutes, above 0; a run that "
            "reaches it stops and "
            "keeps what it measured"
        ),
        "sensors.mutation.max_minutes 10",
        exclusiveMinimum=0,
    ),
    key(
        "sensors.mutation.max_workers",
        "integer",
        "the most mutants tested at once, at least 1",
        "sensors.mutation.max_workers 4",
        minimum=1,
    ),
    key(
        "sensors.mutation.timeout_factor",
        "number",
        (
            "how many times a mutant may run longer than the unmutated suite before it counts as "
            "timed out, above 0; default 10"
        ),
        "sensors.mutation.timeout_factor 5",
        exclusiveMinimum=0,
    ),
    key(
        "sensors.mutation.incremental",
        "boolean",
        "whether a run measures only what changed since the last record; default true",
        "sensors.mutation.incremental false",
    ),
    key(
        "sensors.mutation.record",
        "path",
        (
            "where the sensor keeps what it has measured, relative to the repository; default "
            ".recognizer/cache/mutation/record.json"
        ),
        "sensors.mutation.record .recognizer/cache/mutation/record.json",
    ),
    key(
        "sensors.mutation.survivors",
        "path",
        (
            "where the sensor writes the mutants that survived, relative to the "
            "repository; default "
            ".recognizer/cache/mutation/survivors.json"
        ),
        "sensors.mutation.survivors .recognizer/cache/mutation/survivors.json",
    ),
    key(
        "sensors.mutation.overlay",
        "path",
        (
            "where the sensor writes its overlay, relative to the repository; default "
            ".recognizer/cache/overlays/mutation.json"
        ),
        "sensors.mutation.overlay .recognizer/cache/overlays/mutation.json",
    ),
)

THRESHOLDS_KEYS = (
    key(
        "sensors.thresholds.<metric>",
        "enum",
        "turns the default threshold of a metric off",
        "sensors.thresholds.complexity off",
        values=["off"],
    ),
    key(
        "sensors.thresholds.<metric>.above",
        "number",
        "a finding when the metric is above this value; a metric takes above or below, not both",
        "sensors.thresholds.complexity.above 12",
    ),
    key(
        "sensors.thresholds.<metric>.below",
        "number",
        "a finding when the metric is below this value; a metric takes above or below, not both",
        "sensors.thresholds.coverage.below 0.7",
    ),
    key(
        "sensors.thresholds.<metric>.severity",
        "enum",
        "how a finding of the metric is reported; default warning",
        "sensors.thresholds.complexity.severity violation",
        values=["warning", "violation"],
    ),
)


def key_schema():
    return {
        "keys_version": KEYS_VERSION,
        "owner": "recognizer-sensors",
        "placeholders": PLACEHOLDERS,
        "sections": list(SECTIONS),
        "keys": [
            *TEST_KEYS,
            *CRAP_KEYS,
            *MUTATION_KEYS,
            *THRESHOLDS_KEYS,
        ],
    }


def schema_text() -> str:
    return json.dumps(key_schema(), indent=2) + "\n"
