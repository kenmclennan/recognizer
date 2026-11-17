def key(name, kind, description, example, **extra):
    return {"key": name, "type": kind, "description": description, "example": example, **extra}


CRAP_KEYS = (
    key(
        "sensors.crap.threshold",
        "number",
        "the C.R.A.P. score above which a function is reported, above 0; default 30",
        "sensors.crap.threshold 20",
        exclusiveMinimum=0,
        default=30,
    ),
    key(
        "sensors.crap.coverage_limit",
        "number",
        (
            "the line coverage below which a function is reported, above 0 and at most 1; "
            "false turns the coverage finding off; default 0.6"
        ),
        "sensors.crap.coverage_limit 0.7",
        exclusiveMinimum=0,
        maximum=1,
        off=True,
        default=0.6,
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
        default_text="no time budget: the run continues until it finishes",
    ),
    key(
        "sensors.mutation.max_workers",
        "integer",
        "the most mutants tested at once, at least 1",
        "sensors.mutation.max_workers 4",
        minimum=1,
        default_text="half the machine's cores, fewer if free memory is short",
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
        default=10,
    ),
    key(
        "sensors.mutation.incremental",
        "boolean",
        "whether a run measures only what changed since the last record; default true",
        "sensors.mutation.incremental false",
        default=True,
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
