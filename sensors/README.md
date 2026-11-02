# recognizer-sensors

Recognizer's shipped sensors. Each reads the repository's cached scans and its working tree and writes one findings file (`schema/findings.schema.json`); `crap` also writes an overlay (`schema/overlay.schema.json`). `mutate` is a measurer, not a sensor: it writes an overlay and a survivors file and no findings, and `mutation` reads them.

```sh
recognizer-sensors NAME [--repository P] [--commit C] [--output F] [--settings JSON]
```

`--repository` defaults to `.`, `--commit` to `git rev-parse HEAD`, `--output` to stdout and `--settings` to `{}`. Exit status is `2` for an unknown or missing name, a `--settings` that is not a JSON object or holds a bad or unknown key, a missing repository, no commit and any argument error. `--version` prints the package version, which is also the findings file's `sensor.version`.

A repository registers a shipped sensor in `.recognizer/config.yaml` by name: `sensors: {duplication: {}}`. `recognizer` expands that to `recognizer-sensors duplication --repository {repository} --commit {commit} --output {output} --settings <the mapping as JSON>`.

Install with `uvx --from ./sensors recognizer-sensors` or `pipx install ./sensors`. The names a sensor knows are listed in `fixtures/sensors/shipped.json`.

A sensor reports nothing for a file its grammars do not parse: a file with an extension no grammar covers is skipped, and so is a function whose syntax tree has an error node.

## crap

Scores each function or method by change risk: `crap = cc^2 * (1 - coverage)^3 + cc`, as crap4j and unclebob/crapper do (references, never dependencies). `cc` is the cyclomatic complexity from the syntax tree: one plus each `if`, `elif`, loop, `case`/`when`/match arm, `catch`/`except`, conditional expression, `&&`/`||` (`and`/`or` in Python) and, in TypeScript, each `??` and `?.`. Coverage is the share of a function's LCOV-instrumented lines (`DA` records only, merged by path) that were hit.

| setting | default | meaning |
| --- | --- | --- |
| `threshold` | `30` | a number above 0; a function at or above it is a warning |
| `coverage` | `coverage/lcov.info` | relative path inside the repository to the LCOV file |
| `overlay` | `.recognizer/cache/overlays/crap.json` | relative path inside the repository the overlay is written to |

A missing or unreadable LCOV file makes coverage unknown for every function: one line on stderr, exit `0`. Unknown is never zero: such a function has no `coverage` or `crap` overlay value and warns only when `cc` alone is at or above the threshold (summary `CRAP at least <cc>`). Findings are warnings with the id `crap:<module>::<function>` and the fix pattern `simplify-or-test`. The sensor also writes the overlay with the metrics `complexity`, `coverage` and `crap`, all at member granularity, keyed `module::function` or `module::Class.method`.

## duplication

Reports pairs of functions or methods in the same language whose structure is alike. A function is normalised (local names, parameter names, field names and literals become kind tokens; call names, operators and shape stay), every subtree down to depth 3 is hashed with SHA-1 and the set of hashes is the function's structural fingerprint. A pair is reported when the Jaccard similarity of the two sets is at or above `threshold`.

| setting | default | meaning |
| --- | --- | --- |
| `threshold` | `0.82` | a number above 0 and at most 1 |
| `min_lines` | `4` | functions with fewer lines are skipped (integer >= 1) |
| `min_nodes` | `20` | functions with fewer syntax nodes are skipped (integer >= 1) |

Each finding is a warning on both modules of the pair, with the fix pattern `extract-shared-function` and both functions as evidence members with `file` and `lines`. Written with unclebob/dryer (0BSD) as the reference, never a dependency.

Cost: scoring is quadratic in the number of functions per language, narrowed by a size filter and an inverted index on fingerprints; a very large repository may take minutes. The sensor runs only when asked (`recognizer scan --sense duplication`), never on open.

## mutate

The mutation measurer: it mutates each covered function and runs the repository's tests against every mutant, as unclebob/mutator and clj-mutate do (references, never dependencies). It is registered under `overlays`, not `sensors`: `overlays: {mutate: {test_command: [npm, test]}}`. Run it after `recognizer scan --sense crap`, whose overlay and the LCOV file say which functions and lines are covered.

| setting | default | meaning |
| --- | --- | --- |
| `test_command` | required | non-empty array run as an argument vector in a private copy of the repository |
| `timeout_factor` | `10` | a mutant's timeout is `max(2, timeout_factor * baseline seconds)`; a timed-out run is killed |
| `max_workers` | the core count | integer >= 1, mutants run at once |
| `coverage` | `coverage/lcov.info` | relative path to the LCOV file |
| `crap_overlay` | `.recognizer/cache/overlays/crap.json` | relative path to the CRAP overlay; it must be from the run's commit and hold `coverage` |
| `survivors` | `.recognizer/cache/mutation/survivors.json` | relative path the survivors file is written to |

The operators, one replacement each: `true`/`false` (`True`/`False` in Python), `==`/`!=`, `<`/`<=`, `>`/`>=`, `+`/`-`, `*`/`/`, `&&`/`||` (`and`/`or` and removing `not` in Python), and in TypeScript `===`/`!==` and `??` to `&&`. Strings, comments, generics, unary minus and Rust dereference yield none, and neither does an uncovered line.

The baseline run must pass, or the run exits `2` and writes nothing. A mutant is killed by a non-zero exit, a failure to start or a timeout, and survives on exit `0`. The overlay holds `killed`, `survived` and `uncovered` counts and `score = killed / (killed + survived)` (absent when nothing ran) per function, keyed `module::function`; a function with unknown CRAP coverage is absent. Copies live under `.recognizer/cache/mutation/work/` and are removed as each mutant finishes; a measurer killed with `SIGKILL` leaves its copies behind. The run takes the suite's duration times the covered-site count over `max_workers`.

## mutation

Reads the `mutate` overlay and the survivors file and warns on each function with a surviving mutant, naming each mutation and its line (`line 2 >= to >`), with the fix pattern `strengthen-tests`.

| setting | default | meaning |
| --- | --- | --- |
| `overlay` | `.recognizer/cache/overlays/mutate.json` | relative path to the `mutate` overlay |
| `survivors` | `.recognizer/cache/mutation/survivors.json` | relative path to the survivors file |

When the overlay or survivors file is missing, from another commit than the run's, or disagrees with the overlay's `survived` counts, the sensor reports nothing, prints one line on stderr and exits `0`: survivors are unknown, not healthy.
