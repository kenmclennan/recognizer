# recognizer-sensors

Recognizer's shipped sensors. Each reads the repository's cached scans and its working tree and writes one findings file (`schema/findings.schema.json`); `crap` and `mutation` also write an overlay (`schema/overlay.schema.json`). A sensor is one complete run: `crap` and `mutation` run the repository's tests themselves, so they execute the repository's code in its working tree.

```sh
recognizer-sensors NAME [--repository P] [--commit C] [--output F] [--settings JSON]
```

`--repository` defaults to `.`, `--commit` to `git rev-parse HEAD`, `--output` to stdout and `--settings` to `{}`. Exit status is `2` for an unknown or missing name, a `--settings` that is not a JSON object or holds a bad or unknown key, a missing repository, no commit and any argument error. `--version` prints the package version, which is also the findings file's `sensor.version`.

A repository registers a shipped sensor in `.recognizer/config.yaml` by name: `sensors: {duplication: {}}`. `recognizer` expands that to `recognizer-sensors duplication --repository {repository} --commit {commit} --output {output} --settings <the mapping as JSON>`.

Install with `uvx --from ./sensors recognizer-sensors` or `pipx install ./sensors`. The names a sensor knows are listed in `fixtures/sensors/shipped.json`.

A sensor reports nothing for a file its grammars do not parse: a file with an extension no grammar covers is skipped, and so is a function whose syntax tree has an error node.

## crap

Scores each function or method by change risk: `crap = cc^2 * (1 - coverage)^3 + cc`, as crap4j and unclebob/crapper do (references, never dependencies). `cc` is the cyclomatic complexity from the syntax tree: one plus each `if`, `elif`, loop, `case`/`when`/match arm, `catch`/`except`, conditional expression, `&&`/`||` (`and`/`or` in Python) and, in TypeScript, each `??` and `?.`. Coverage is the share of a function's instrumented lines (merged by path) that were hit.

It runs the repository's tests under the language's coverage tool in the same run (see Language profiles below), so it runs the repository's code in the working tree. `modified` is taken before the tests start.

| setting | default | meaning |
| --- | --- | --- |
| `threshold` | `30` | a number above 0; a function at or above it is a warning |
| `test_command` | the language profile | non-empty array of non-empty strings; replaces the profile and runs once |
| `coverage` | none | relative path to a coverage report the repository already produces; `.xml` is read as JaCoCo, anything else as LCOV |
| `overlay` | `.recognizer/cache/overlays/crap.json` | relative path inside the repository the overlay is written to |

Unknown is never zero: a function whose file has no entry in the report has no `coverage` or `crap` overlay value and warns only when `cc` alone is at or above the threshold (summary `CRAP at least <cc>`). Findings are warnings with the id `crap:<module>::<function>` and the fix pattern `simplify-or-test`. The sensor also writes the overlay with the metrics `complexity`, `coverage` and `crap`, all at member granularity, keyed `module::function` or `module::Class.method`.

### Language profiles

A repository's languages are the ones with a scan in the cache, taken in the order python, typescript, kotlin, rust, csharp. Each language runs its profile's command from the repository root, in turn, and the first failure stops the run. Reports are merged by repository-relative path.

| language | command | report |
| --- | --- | --- |
| python | `<runner> coverage run -m pytest`, then `<runner> coverage lcov` | `.recognizer/cache/coverage/python.lcov` |
| typescript | `npx --yes c8 --reporter=lcovonly --reports-dir .recognizer/cache/coverage/typescript npm test` | `.recognizer/cache/coverage/typescript/lcov.info` |
| kotlin | `./gradlew test jacocoTestReport` | `**/build/reports/jacoco/test/jacocoTestReport.xml` (JaCoCo) |
| rust | `cargo llvm-cov --lcov --output-path .recognizer/cache/coverage/rust.lcov` | `.recognizer/cache/coverage/rust.lcov` |
| csharp | `dotnet test "--collect:XPlat Code Coverage;Format=lcov" --results-directory .recognizer/cache/coverage/csharp` | `.recognizer/cache/coverage/csharp/*/coverage.info` (one LCOV file per test project, merged) |

The Python `<runner>` is `uv run` when `uv.lock` exists at the repository root, else `poetry run` when `poetry.lock` exists, else `python3 -m`. The sensor installs nothing: Python needs `coverage` and `pytest` in the runner's environment, TypeScript needs a `test` script, Kotlin needs a Gradle wrapper with the `jacoco` plugin applied, Rust needs `cargo-llvm-cov`, and C# needs the .NET SDK on `PATH`. Without it C.R.A.P. and mutation exit 2 with `the test command did not start: dotnet`, while duplication and thresholds never run it. Before the default C# profile runs, each directory in the C# scan's `skip_paths` that holds a `.csproj` must name `coverlet.collector` in that project or in a `Directory.Build.props`, `Directory.Build.targets` or `Directory.Packages.props` in that directory or an ancestor up to the repository root; otherwise the run stops with `the csharp test project <directory> does not reference coverlet.collector`. A reference pulled in from anywhere else is not seen: set `test_command` or `coverage` to skip the check. A C# `test_command` must write coverlet's reports under the results directory above, for example `["dotnet","test","tests/Shop.UnitTests","--collect:XPlat Code Coverage;Format=lcov","--results-directory",".recognizer/cache/coverage/csharp"]`, or the run ends `the test command left no coverage report`. Each run clears the previous C# reports first. `test_command` replaces the profiles and runs once, and the default report locations are then read unless `coverage` names a file. `coverage` alone runs no command and reads the file.

When a command does not start, exits non-zero or leaves no report, the sensor writes nothing and exits `2` with one stderr line and no prefix: `the test command exited 1`, `the python test command exited 1` (more than one language), `the test command did not start: python3`, `the test command left no coverage report: <path>` or `the coverage file is missing: <path>`. The combined output of every command is in `.recognizer/cache/coverage/last-run.log`. The commands run in the sensor's own process group, so killing the group ends them.

## duplication

Reports pairs and families of functions or methods in the same language whose structure is alike. A function is normalised (local names, parameter names, field names and literals become kind tokens; call names, operators and shape stay), every subtree down to depth 3 is hashed with SHA-1 and the set of hashes is the function's structural fingerprint. A pair is linked when the Jaccard similarity of the two sets is at or above `threshold`; each connected group of linked functions (a duplication family) is one finding, and a plain pair is a family of two.

| setting | default | meaning |
| --- | --- | --- |
| `threshold` | `0.82` | a number above 0 and at most 1 |
| `min_lines` | `4` | functions with fewer lines are skipped (integer >= 1) |
| `min_nodes` | `20` | functions with fewer syntax nodes are skipped (integer >= 1) |

Two shapes are skipped before fingerprinting, because same-shaped functions of this kind are rightly separate. A constructor shape is a body of only assignments whose right-hand side is a parameter or a literal: Python, TypeScript, Kotlin and C# `field = parameter` statements (plain `=` only), and in Rust the same statements or a single `Self { a, b: 1, c: param }` struct expression. An accessor shape is a body of one result (a `return`, or in Rust, Kotlin and C# an expression body or tail expression) that is a member access, subscript or call chain over a name or `self`/`this`, where every call argument and subscript index is a literal or `self`/`this`. A body with a branch, a local variable, an operator or a non-literal argument is neither, and is scored as before. A language's null (`None`, Kotlin `null`, Rust `None`) counts as a literal only where its grammar parses it as one: Kotlin `null` and Rust `None` do not.

Each finding is a warning on every member's module, with the fix pattern `extract-shared-function` and every member function as an evidence member with `file` and `lines`. A pair keeps the id `duplication:<a>|<b>`; a family of three or more is `duplication:<a>|<b>#<n>` (its first two members and the member count), its summary names every member, and its similarity is the lowest linking pair's. Written with unclebob/dryer (0BSD) as the reference, never a dependency.

Cost: scoring is quadratic in the number of functions per language, narrowed by a size filter and an inverted index on fingerprints; a very large repository may take minutes. The sensor runs only when asked (`recognizer scan --sense duplication`), never on open.

## mutation

Mutates each covered function and runs the repository's tests against every mutant, as unclebob/mutator and clj-mutate do (references, never dependencies), then warns on each function with a surviving mutant, naming each mutation and its line (`line 2 >= to >`), with the fix pattern `strengthen-tests`. One run does it all: the coverage pass (the profile commands above, or `coverage`), the mutants, and the writes. A baseline run of each distinct test command is taken the first time a mutant needs it, in one of at most `max_workers` shared baseline copies (a baseline waits for a free copy rather than copying again).

| setting | default | meaning |
| --- | --- | --- |
| `test_command` | the language profile's plain test command | non-empty array run as an argument vector in a private copy of the repository; if set it is used for every language, is never run for coverage, and turns test selection off (no selection is appended to it) |
| `timeout_factor` | `10` | a mutant's timeout is `max(2, timeout_factor * baseline seconds)` of the baseline of the command that mutant runs; a timed-out run is killed |
| `max_workers` | the core count | integer >= 1, mutants run at once |
| `coverage` | none | relative path to a coverage report the repository already produces, used instead of the coverage pass |
| `overlay` | `.recognizer/cache/overlays/mutation.json` | relative path the overlay is written to |
| `survivors` | `.recognizer/cache/mutation/survivors.json` | relative path the survivors file is written to |
| `record` | `.recognizer/cache/mutation/record.json` | relative path the mutation record is written to |
| `incremental` | `true` | `false` ignores the record and mutates every function; the record is still written |
| `max_minutes` | none | number above 0; no function starts once this many minutes have passed since the first mutant was handed to a worker (the coverage pass is not counted) |

The operators, one replacement each: `true`/`false` (`True`/`False` in Python), `==`/`!=`, `<`/`<=`, `>`/`>=`, `+`/`-`, `*`/`/`, `&&`/`||` (`and`/`or` and removing `not` in Python), and in TypeScript `===`/`!==` and `??` to `&&` (C# has no `??` site). Strings, comments, generics, unary minus, Rust dereference and a C# `#if` condition yield none, and neither does an uncovered line.

A failing coverage pass or baseline writes nothing and exits `2` with the one-line sentences listed under `crap` (the baseline's output tail goes to `last-run.log`). A mutant is killed by a non-zero exit, a failure to start or a timeout, and survives on exit `0`. The sensor writes the survivors file and the record, then the overlay, then the findings. The overlay holds `killed`, `survived` and `uncovered` counts and `score = killed / (killed + survived)` (absent when nothing ran) per function, keyed `module::function`; a function with unknown coverage is absent. It removes a stale `.recognizer/cache/overlays/mutate.json` when it writes its overlay. Copies live under `.recognizer/cache/mutation/work/` and are removed as each mutant finishes; a run killed with `SIGKILL` leaves its copies behind. A run with the whole suite per mutant takes the suite's duration times the covered-site count over `max_workers`; with test selection each mutant takes only the duration of the test files that executed its line.

A timed-out mutant is a kill: it counts in `killed` and the score, is listed under `timeouts` in the survivors file and never under `survivors`.

**Test selection.** When no `coverage` setting names a report and `test_command` is not set, the coverage pass also records which test files executed each line, and a mutant runs only the files that executed the line its site is covered by (the greatest recorded line from the function's start up to the site). Python runs `<runner> pytest <files>`; the pass runs `coverage run -m pytest -p recognizer_covctx`, a plugin shipped with the sensors that switches coverage.py's context to the test file around each test, and reads `coverage json --show-contexts`. TypeScript runs `npm test -- <files>`; the pass adds one c8 run per `*.test.*` or `*.spec.*` file in the scan (`npm test -- <file>`, reports in `.recognizer/cache/coverage/typescript/by-file/`) and one failing run drops TypeScript selection for the run. Kotlin, Rust and C# run the whole suite. A line whose contexts are not all existing files (import-time code, code outside any test, a repository's own `dynamic_context`), a selection of more than 50 files, a selection of more than half the suite (the distinct test files across all recorded lines; it takes no baseline of its own) or a file name starting with `-` runs the whole suite. A selected command whose baseline fails falls back to the whole suite with one stderr line; a failing whole-suite baseline exits `2`. A mutant that only an unattributed side effect (a session fixture credited to the first file that used it) would have killed can survive; set `test_command` or `incremental: false` for a full verdict.

**Mutation record.** Beside the survivors file the run writes the record (version 2): per function, the sha256 of its body, one verdict per mutation site (`killed`, `survived`, `timeout`, or `null` for an uncovered site) and, per covered site, the test files that ran it (`ran`) and, for a kill, the test files the runner reported failing (`killer`), each with its hash; plus `support`, the hash of the shared fixture files (every test file that is neither a test entry nor a `conftest.py`), the sha256 of the resolved test commands (the array itself when `test_command` is set, otherwise a mapping from language to command with a selection marker), the commit as provenance and the identities the last run skipped. Each site is judged on its own: a killed or timed-out site is reused while its function's body hash and every file in its `killer` map, counting the `conftest.py` files on their paths, are unchanged by hash; a surviving site is rerun when a covering test file is new or changed; a covered site with no verdict is run for the first time. A change to a shared support file voids all reuse. A site with no covering test files (Kotlin, Rust, C#, a `test_command`, dropped TypeScript selection) records `ran: null` and is reused only while the hash of all test files is unchanged. Python mutants run with `-rfE` and `killer` is read from the `FAILED` and `ERROR` lines, falling back to `ran` when they are missing or name an unknown path. The same rule applies with and without a module scope: a function outside the scope is carried only when every covered site passes it, and otherwise has no result. A function that only moved keeps its verdicts and reports its new lines. A missing, unreadable or other-version record, or a changed test command, means a full run. Known limit: a change to a callee or other production code, with the function's body and test files unchanged, leaves a stale verdict the rule cannot see, as does a test file the convention in `mutation/test_files.py` does not recognise; set `incremental: false` for a full re-verdict.

**Budget.** With `max_minutes` set, work is queued by function: the functions the last run skipped first, then the rest, each in identity order. A function is wholly reused, wholly mutated or skipped; one already running when the budget ends finishes, so a run can overshoot by up to one function per worker. A skipped function is absent from the overlay (unknown, never healthy), listed in the survivors file's `skipped` with reason `uncovered-by-budget`, and `complete` is `false`. The survivors file also carries `reused`, the number of reused functions, and `unmeasured`: `{"budget": <functions in skipped>, "no-covering-test": <functions with known coverage and mutation sites, none covered>}`. Every run prints `recognizer-sensors: mutation: <r> of <n> functions reused, <m> mutated, <k> skipped (uncovered-by-budget)` on stderr, then a line with the functions without a covering test and how many mutants ran a selection or the whole suite, and exits `0`. The coverage pass is outside the budget, so a run can exceed `max_minutes` by its duration.

## thresholds

Reads every current overlay in `.recognizer/cache/overlays/` and writes one finding for each module or member whose value for a configured metric crosses its line. It measures nothing. The settings are a mapping from metric name to a line: `{above: N}` or `{below: N}` with an optional `severity` of `warning` (default) or `violation`, or the string `off` to switch a metric's line off.

| metric       | default line |
| ------------ | ------------ |
| `complexity` | above 10     |
| `coverage`   | below 0.6    |

There is no default for `crap` or `survived`: the `crap` and `mutation` sensors judge those, and a user may still name them. An entry replaces a metric's default whole. An `above` line fires at `value >= line` and a `below` line at `value < line`. A finding has the id `thresholds:<metric>:<key>` (the overlay's own key), the kind `thresholds.<metric>`, the principle `tests-cover-the-code` for `coverage`, `functions-stay-small` for `complexity` and the metric's name otherwise, the new `metric` field, and `evidence.measures` `{value, line}` with `evidence.producer` naming the overlay's producer. A violation ratchets in the baseline by its id.

An overlay of another commit, or an unreadable one, is skipped with a line on stderr. The first overlay by file name that declares a metric supplies all of its values. A key matching no scanned module is counted and skipped; a metric you named that no current overlay declares prints a line. `recognizer scan --sense` runs sensors in the config's order, so list `thresholds` after `crap` to judge that run's overlay.
