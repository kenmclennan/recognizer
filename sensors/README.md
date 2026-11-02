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
| `record` | `.recognizer/cache/mutation/record.json` | relative path the mutation record is written to |
| `incremental` | `true` | `false` ignores the record and mutates every function; the record is still written |
| `max_minutes` | none | number above 0; no function starts once this many minutes have passed since the run began |

The operators, one replacement each: `true`/`false` (`True`/`False` in Python), `==`/`!=`, `<`/`<=`, `>`/`>=`, `+`/`-`, `*`/`/`, `&&`/`||` (`and`/`or` and removing `not` in Python), and in TypeScript `===`/`!==` and `??` to `&&`. Strings, comments, generics, unary minus and Rust dereference yield none, and neither does an uncovered line.

The baseline run must pass, or the run exits `2` and writes nothing. A mutant is killed by a non-zero exit, a failure to start or a timeout, and survives on exit `0`. The overlay holds `killed`, `survived` and `uncovered` counts and `score = killed / (killed + survived)` (absent when nothing ran) per function, keyed `module::function`; a function with unknown CRAP coverage is absent. Copies live under `.recognizer/cache/mutation/work/` and are removed as each mutant finishes; a measurer killed with `SIGKILL` leaves its copies behind. The run takes the suite's duration times the covered-site count over `max_workers` on a first or full run.

A timed-out mutant is a kill: it counts in `killed` and the score, is listed under `timeouts` in the survivors file and never under `survivors`.

**Mutation record.** Beside the survivors file the run writes the record: per function, the sha256 of its body and one verdict per mutation site (`killed`, `survived`, `timeout`, or `null` for an uncovered site), plus the sha256 of `test_command`, the commit and the identities the last run skipped. A rerun reuses a function's verdicts when its body hash matches and the set of covered sites is the same; a function that only moved keeps its verdicts and reports its new lines. A missing, unreadable or other-version record, or a changed `test_command` (any argument, its order or its length), means a full run. Before reusing, the run asks git which paths differ between the record's commit and the working tree (tracked, staged, committed, untracked or deleted); if any is a test file by the `unused-exports` convention, or git cannot compare with that commit, every verdict is dropped and one stderr line says so. Known limit: a change to a callee or other production code, with the function's body and `test_command` unchanged, leaves a stale verdict the rule cannot see, as does a test file the convention does not recognise; set `incremental: false` for a full re-verdict.

**Budget.** With `max_minutes` set, work is queued by function: the functions the last run skipped first, then the rest, each in identity order. A function is wholly reused, wholly mutated or skipped; one already running when the budget ends finishes, so a run can overshoot by up to one function per worker. A skipped function is absent from the overlay (unknown, never healthy), listed in the survivors file's `skipped` with reason `uncovered-by-budget`, and `complete` is `false`. The survivors file also carries `reused`, the number of reused functions. Every run prints `recognizer-sensors: mutate: <r> of <n> functions reused, <m> mutated, <k> skipped (uncovered-by-budget)` on stderr and exits `0`.

## mutation

Reads the `mutate` overlay and the survivors file and warns on each function with a surviving mutant, naming each mutation and its line (`line 2 >= to >`), with the fix pattern `strengthen-tests`.

| setting | default | meaning |
| --- | --- | --- |
| `overlay` | `.recognizer/cache/overlays/mutate.json` | relative path to the `mutate` overlay |
| `survivors` | `.recognizer/cache/mutation/survivors.json` | relative path to the survivors file |

When the overlay or survivors file is missing, from another commit than the run's, or disagrees with the overlay's `survived` counts, the sensor reports nothing, prints one line on stderr and exits `0`: survivors are unknown, not healthy. When the survivors file has `complete: false` it prints `recognizer-sensors: mutation: <k> functions were not measured (budget); their survivors are unknown` and still reports the survivors it has.

## unused-exports

Reports, per module, the exports that no other module uses. It reads the cached scans only: a member with `exported: true` is unused when no edge from another module names it. A `depends` edge uses a name in its `names`; a `depends` edge with no names (a namespace, wildcard or side-effect import) uses every export of its target; an `inherits` or `implements` edge uses its `to_member`. A dotted member such as `Currency.Companion` is used when it or its leading segment (`Currency`) is. Edges to `foreign:` ids and from a module to itself are ignored.

| setting | default | meaning |
| --- | --- | --- |
| `entry_points` | `[]` | array of non-empty globs; a module that matches is skipped, as for the orphan warning |

Test files and index-like files (`index`, `__init__`, `main`, `mod`, `lib`) are always skipped, by the rules of `check/src/entry-points.ts` ported to `entry_points.py` and checked against `fixtures/sensors/entry-points.json`. The policy's literal entries are not honoured. When `sensors.unused-exports` sets no `entry_points` and `sensors.structure.warnings.orphan` has an `entry_points` array, `recognizer` passes that array when it expands the short form; this sensor never reads the config.

One warning per module, id `unused-exports:<module>`, fix pattern `narrow-exports`, the names sorted in the summary and each as an evidence member with `file` and `lines` (a Kotlin member whose file cannot be resolved carries `module` and `name` only). The sensor reports candidates: an export reached by a dynamic import, reflection or a framework convention looks unused.

## thresholds

Reads every current overlay in `.recognizer/cache/overlays/` and writes one finding for each module or member whose value for a configured metric crosses its line. It measures nothing. The settings are a mapping from metric name to a line: `{above: N}` or `{below: N}` with an optional `severity` of `warning` (default) or `violation`, or the string `off` to switch a metric's line off.

| metric       | default line |
| ------------ | ------------ |
| `complexity` | above 10     |
| `coverage`   | below 0.6    |

There is no default for `crap` or `survived`: the `crap` and `mutation` sensors judge those, and a user may still name them. An entry replaces a metric's default whole. An `above` line fires at `value >= line` and a `below` line at `value < line`. A finding has the id `thresholds:<metric>:<key>` (the overlay's own key), the kind `thresholds.<metric>`, the principle `tests-cover-the-code` for `coverage`, `functions-stay-small` for `complexity` and the metric's name otherwise, the new `metric` field, and `evidence.measures` `{value, line}` with `evidence.producer` naming the overlay's producer. A violation ratchets in the baseline by its id.

An overlay of another commit, or an unreadable one, is skipped with a line on stderr. The first overlay by file name that declares a metric supplies all of its values. A key matching no scanned module is counted and skipped; a metric you named that no current overlay declares prints a line. `recognizer scan --sense` runs sensors in the config's order, so list `thresholds` after `crap` to judge that run's overlay.
