# Thresholds sensor validation

## Verdict

**trust.** Over 50 planted functions at, just over and just under each line, two sets of lines, a mixed-resolution overlay and a stale overlay, the sensor's finding set equals the labelled set exactly, with the same value, line and severity in every finding.

## Method

- Recognizer commit `1dbb09c`.
- Reference tool: none. The sensor reads overlay values and a line and never opens a source file (`thresholds/sensor.py`), so no independent measure of its own can exist; the labelled corpus is the comparison. The labels follow REC-142 decision 2: `above` fires when `value > line`, `below` fires when `value < line`.
- Corpus: `fixtures/thresholds/corpus/`, ten planted functions in each of Python, TypeScript, Kotlin, Rust and C#, written by the corpus build as source in each language, with a hand-chosen `coverage/lcov.info`. `sensors/tests/test_corpus.py` runs the C.R.A.P. sensor to write the overlay (with the CRAP line set above every planted score so it competes with nothing), then thresholds, and compares to `expected.json`. Every label is derived from the planted complexity and the planted hit counts, not from a sensor run.
- No script is kept in `validation/thresholds/`: the CI test is the comparison and has no reference tool to run.

## Comparisons

### Boundary readings, default lines (complexity above 10, coverage below 0.6)

Per language the planted functions are complexity 9, 10 and 11, each at three coverages, and one far over both lines (complexity 25, coverage 0.1). The coverages are 10 of 17 lines (0.5882), 3 of 5 (0.6) and 11 of 18 (0.6111), the nearest ratios just under, at and just over 0.6 that a function of 18 to 22 lines can hold; the spec's 0.59 and 0.61 would need 100-line functions.

| result | count |
| --- | --- |
| planted functions | 50 (10 per language) |
| labelled function-metric cases per run | 100 |
| findings expected and produced | 40 (4 complexity and 3 coverage per language plus 2 for the far function) |
| missing findings | 0 |
| extra findings | 0 |
| findings with the wrong value or line | 0 |

Complexity 9 and 10 never fire, 11 always fires (10 is not above 10); coverage 0.5882 fires, 0.6 and 0.6111 never fire, so the exact value 0.6 is not a finding, as decision 2 requires.

### Non-default lines and severity (complexity above 11 as a violation, coverage below 0.61)

The same 100 cases against moved lines. Expected and produced: 40 findings (1 complexity and 7 coverage per language, the far function included in both), 0 missing, 0 extra, every complexity finding `violation` and every coverage finding `warning`. Complexity 10 and 11 do not fire (neither is above 11); coverage 0.6111 stays out and 0.6 now fires.

### Mixed resolution

An overlay naming five ids that resolve and three that do not: the two resolving ids that cross the default lines (`c11_at` at 11, `c10_under` at 0.5) produce their findings, the three resolving ids that do not cross (`c10_at` at 10, `c09_at`, `c10_over`) produce none, and the stderr lines `2 ids of complexity in mixed.json match no scanned module; skipped` and `1 ids of coverage in mixed.json match no scanned module; skipped` are present. Agrees.

### Overlay from another commit

An overlay whose commit is not the repository's HEAD produces no finding although a value in it would cross the line, and prints `overlay stale.json is from commit 0000000000000000000000000000000000000000, not <HEAD>; skipped`. Agrees.

C# is measured against hand counts only: no .NET SDK was available, so no reference tool ran for it, and the sensor reads overlay values rather than C# source either way.

## Disagreements

None. Two behaviours are worth knowing and are by design (REC-142): the first overlay by file name supplies a metric when two declare it, and a value that is not a finite number is skipped without a line on stderr.

## Defects to file

None.
