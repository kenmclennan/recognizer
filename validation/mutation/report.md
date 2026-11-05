# Mutation sensor validation

## Verdict

**incomplete.** On everything that ran the sensor agrees with mutmut and Stryker wherever they make the same edit (30 of 31 verdict pairs equal, the one difference being how an uncovered function is labelled), it applies a subset of their operators by design, and every survivor it reports is either killable by a named assertion or an equivalent mutant; the lean is `trust`. The mutmut runs on three lightcycle modules did not run, so the verdict stays `incomplete`.

## Method

- Recognizer commit `1dbb09c`; lightcycle commit `c1933e0` (not used, see below).
- Corpus: `fixtures/mutation/corpus/`, a Python module `app/shop.py` and a TypeScript module `src/shop.ts` of eight functions each, with tests that are deliberately strong, weak or absent, and a hand-written `coverage/lcov.info`. `expected.json` records each function's killed, survived and uncovered counts and each survivor with the reason, written from reading the code and the tests. `sensors/tests/test_corpus.py` runs the real sensor over it in CI (the TypeScript half runs only where `node --experimental-strip-types` works).
- Reference tools, versions pinned: mutmut 3.8.1 with pytest 9.2.0 (Python), Stryker 10.1.1 with its command runner and `coverageAnalysis: off` (TypeScript), coverage.py 7.17.1 and c8 12.0.0 to produce the lcov the sensor needs, node 24.13.0.
- Scripts: `validation/mutation/compare_python.py` and `validation/mutation/compare_typescript.py`, with `common.py`; run them from `sensors/` with `PYTHONPATH=../validation/mutation uv run python ../validation/mutation/compare_python.py --repository <path> --source <file> --pytest <pytest file> --venv <venv with mutmut>` (and `--stryker <path> --c8 <path>` for the TypeScript one). Each copies the repository twice and never writes to it.

## Comparisons

### Operators applied (three buckets)

Each reference mutant is placed in a bucket by comparing its single-token edit with the sensor's sites: **matched** (same line, original token and replacement), **outside by design** (a token the sensor does not mutate: number, string, return value, block, condition-to-constant), or **inside but not generated** (the original token is in the sensor's operator set but the sensor makes a different or no replacement there).

| run | reference mutants | matched | outside by design | inside but not generated | sensor sites with no reference mutant |
| --- | --- | --- | --- | --- | --- |
| mutmut, corpus `app/shop.py` | 16 | 12 | 4 | 0 | 0 |
| mutmut, `fixtures/mutation/sample` | 12 | 4 | 8 | 0 | 0 |
| Stryker, corpus `src/shop.ts` | 37 | 11 | 22 | 4 | 1 |
| mutmut, three lightcycle modules | not run | not run | not run | not run | not run |

The four mutmut mutants outside the design on the corpus are number edits (`18` to `19`, `10` to `11`, `2` to `3`, `1` to `2`); the eight on the sample are number edits (`90`, `50`) and string edits. Stryker's 22 are `BlockStatement` (empty the block), `ConditionalExpression` (replace a condition by `true` or `false`) and similar.

The mutmut runs on three small lightcycle modules are not run: the spec leaves them to the driver. The harness is the same script with `--repository <lightcycle checkout> --source lightcycle/<module>.py --pytest tests/<module test>.py`, taking modules under 120 lines whose test file runs in under ten seconds; the corpus run took under two seconds per tool.

### Inside the operator set but not generated (the third bucket)

| function | line | reference edit | verdict | sensor |
| --- | --- | --- | --- | --- |
| `clamp` | 2 | `x < lo` to `x >= lo` | killed | makes `<` to `<=` only |
| `clamp` | 5 | `x > hi` to `x <= hi` | killed | makes `>` to `>=` only |
| `isAdult` | 12 | `age >= 18` to `age < 18` | killed | makes `>=` to `>` only |
| `tiered` | 36 | `n > 10` to `n <= 10` | killed | makes `>` to `>=` only |

Stryker's `EqualityOperator` makes two replacements for each comparison, the sensor makes one (`SWAPS`). All four extra Stryker mutants are killed, so the sensor's survivor set would not change if it made them; this is a difference in operator set, not a defect.

One sensor site has no Stryker mutant: `pick` at line 24, `a ?? b` to `a && b`. Stryker 10.1.1 produced no mutant for `(a ?? b) as number`; the cause was not investigated.

### Verdicts for matched mutants

Where both tools make the same edit, the verdicts must agree.

| run                          | matched | agree | differ |
| ---------------------------- | ------- | ----- | ------ |
| mutmut, corpus               | 12      | 12    | 0      |
| mutmut, sample, weak tests   | 4       | 4     | 0      |
| mutmut, sample, strong tests | 4       | 4     | 0      |
| Stryker, corpus              | 11      | 10    | 1      |

The one difference: `untested` `a - b` to `a + b` is `uncovered` for the sensor (the line has no coverage, so no run) and `Survived` for Stryker, which with `coverageAnalysis: off` runs every test against every mutant and finds nothing exercising it; mutmut labels the same mutant `no tests`, matching the sensor. This is definitional: the sensor and mutmut separate "never run" from "survived", and Stryker with coverage analysis off does not.

### Counts per function, side by side

Corpus Python, matched mutants only (killed / survived / uncovered); the TypeScript module gives the same counts for the sensor and for Stryker apart from `untested`.

| function | sensor | mutmut |
| --- | --- | --- |
| `clamp` | 0 / 2 / 0 | 0 / 2 / 0 |
| `is_adult` | 0 / 1 / 0 | 0 / 1 / 0 (plus 1 survived number edit outside the design) |
| `total` | 1 / 0 / 0 | 1 / 0 / 0 |
| `both` | 0 / 1 / 0 | 0 / 1 / 0 |
| `invert` | 1 / 0 / 0 | 1 / 0 / 0 |
| `default_enabled` | 0 / 1 / 0 | 0 / 1 / 0 |
| `untested` | 0 / 0 / 1 | no tests |
| `tiered` | 2 / 2 / 0 | 2 / 2 / 0 (plus 3 killed number edits outside the design) |

Sample with weak tests: `grade` 0 / 2 / 0 and `both` 0 / 1 / 0 for the sensor, `total` 0 / 0 / 1; mutmut gives the same on its matched mutants, with `total` as `no tests`. With strong tests: `grade` 2 / 0 / 0, `both` 1 / 0 / 0, `total` 0 / 0 / 1 for both.

### Every reported survivor, read

A survivor is killable when some assertion makes the original and the mutant differ.

| module and function | survivor | killable | assertion that would kill it, or why not |
| --- | --- | --- | --- |
| corpus Python `clamp` | line 2 `<` to `<=` | no | equivalent: when `x == lo` the original falls through and returns `x`, which is `lo`; the mutant returns `lo`, the same value |
| corpus Python `clamp` | line 4 `>` to `>=` | no | equivalent, by the same argument with `hi` |
| corpus Python `is_adult` | line 10 `>=` to `>` | yes | `assert is_adult(18) is True` |
| corpus Python `both` | line 18 `and` to `or` | yes | `assert both(True, False) is False` |
| corpus Python `default_enabled` | line 26 `True` to `False` | yes | `assert default_enabled() is True`; the test discards the result |
| corpus Python `tiered` | line 34 `>` to `>=` | yes | `assert tiered(10, True) == 11` |
| corpus Python `tiered` | line 34 `and` to `or` | yes | `assert tiered(11, False) == 12` |
| corpus TypeScript | the same eight survivors at lines 2 and 5 (`clamp`), 12 (`isAdult`), 20 (`both`), 28 (`defaultEnabled`) and 36 twice (`tiered`) | as above | as above, with `assert.equal(...)` |
| sample `grade` (weak) | line 2 `>=` to `>` | yes | `assert grade(90) == "A"` |
| sample `grade` (weak) | line 4 `>=` to `>` | yes | `assert grade(50) == "pass"` |
| sample `both` (weak) | line 10 `and` to `or` | yes | `assert both(True, False) is False` |

The sample under strong tests reports no survivor. No timeout was reported on any run.

## Disagreements

| item | classification | note |
| --- | --- | --- |
| Stryker makes two replacements per comparison, the sensor one | definitional | four extra Stryker mutants on the corpus, all killed |
| the sensor makes no number, string, block or condition-to-constant mutations | definitional | by REC-131's operator set; mutmut's number edits and Stryker's block and condition edits fall here |
| `untested` is `Survived` in Stryker, `uncovered` in the sensor | definitional | Stryker with `coverageAnalysis: off`; mutmut agrees with the sensor |
| `pick` `??` to `&&` has no Stryker mutant | reference | not investigated; the sensor's site is a legitimate edit and its mutant is killed |

No disagreement is a defect in the sensor by REC-131.

## Defects to file

None found. To close the `incomplete` verdict the driver runs the mutmut comparison on three lightcycle modules with the commands above and updates the tables.

## Selection spread

`validation/mutation/selection_spread.py <python.contexts.json> <repository>` prints, from the contexts file a coverage pass wrote, the number of lines executed by each count of test files, the lines above the 50-file cap, the lines above half the suite, and the lines that cannot be selected (an empty or non-file context). It writes nothing. The sensor runs the whole suite, with no baseline of its own, for a selection of more than half the suite, and its baselines share at most `max_workers` copies of the repository.

The before and after figures for lightcycle at `c1933e0` (`max_minutes: 5`, `max_workers: 4`, idle machine) are recorded in the REC-208 pull request by the driver.

## C-sharp

C# is measured against hand counts only: `fixtures/mutation/corpus/csharp/` holds 8 hand-labelled functions (one with a `#if A == B` condition that yields no site and a statement under `#if` that yields one) run through a Python runner script that reads the mutated `.cs` text, and `sensors/tests/test_corpus.py` checks them in CI. No reference tool ran for C# and no .NET SDK was available on the machine that wrote the labels.
