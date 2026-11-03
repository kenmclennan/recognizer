# C.R.A.P. sensor validation

## Verdict

**incomplete.** Everything that ran agrees with the sensor's own spec (REC-130) and every difference from a reference tool is definitional, so no defect was found and the lean is `trust`; but the Kotlin complexity and coverage references and the Rust coverage reference did not run, so the verdict cannot be `trust` yet. The lightcycle complexity run was done by the driver after merge: 3306 functions compared with radon, 3303 equal, the 3 others definitional (below).

## Method

- Recognizer commit `1dbb09c` (base of this change); lightcycle commit `c1933e0` (not used, see below).
- Corpus: `fixtures/crap/corpus/`, 12 functions per language (Python, TypeScript, Kotlin, Rust) with complexity 1 to 12, every node type in `NODE_TYPES` and every operator in `OPERATORS` used at least once, hand-chosen coverage in `coverage/lcov.info` and `coverage/jacoco.xml`, and `expected.json` derived by hand from REC-130's node table. `sensors/tests/test_corpus.py` checks all 48 in CI.
- Reference tools, versions pinned: radon 6.0.1 (Python), eslint 9.39.5 with `typescript-eslint` and `complexity: max 0` (TypeScript), rust-code-analysis-cli 0.0.25 (Rust), coverage.py 7.17.1 and c8 12.0.0 on node 24.13.0 (native coverage), installed into throwaway folders outside the repository. Not available: a JVM, so no detekt and no jacoco; `llvm-tools-preview` could not be added to the rustup toolchain (component conflict on `lib/rustlib/aarch64-apple-darwin/bin/llc`), so `cargo llvm-cov 0.9.1` installed but could not run.
- Scripts: `validation/crap/complexity.py` and `validation/crap/coverage.py`, both taking `--repository` or tool paths; run them from `sensors/` with `uv run python ../validation/crap/<script>.py`.

## Comparisons

### Complexity against reference tools

Matched on file and start line, over the corpus, `fixtures/crap/sample`, `fixtures/python`, `fixtures/typescript` and `fixtures/rust`.

| language | reference | compared | equal | different | reference-only units |
| --- | --- | --- | --- | --- | --- |
| Python | radon | 27 | 26 | 1 | 0 |
| TypeScript | eslint `complexity` | 24 | 24 | 0 | 3 |
| Rust | rust-code-analysis | 20 | 19 | 1 | 1 |
| Kotlin | detekt | not run | not run | not run | not run |
| lightcycle (Python) | radon 6.0.1 | 3306 | 3303 | 3 | 0 |

Kotlin is not run because there is no JVM here; the 21 Kotlin functions (12 in the corpus, 9 in `fixtures/kotlin`) are measured by the sensor only. lightcycle was run by the driver on 2026-11-03 at lightcycle commit `c1933e0` in a clean worktree, with `--repository <worktree> --prefix lightcycle --radon <radon>`: 3306 functions, 3303 equal.

### Coverage against the coverage tool's own report

The sensor reads the tool's lcov; the native figure is recomputed from the tool's own JSON over the same function line ranges (coverage.py `json` executed and missing lines; c8 `coverage-final.json` statement counts per line).

| language   | tool           | compared | equal   |
| ---------- | -------------- | -------- | ------- |
| Python     | coverage.py    | 12       | 12      |
| TypeScript | c8             | 12       | 12      |
| Rust       | cargo llvm-cov | not run  | not run |
| Kotlin     | jacoco         | not run  | not run |

Rust is not run because `cargo llvm-cov` could not install its llvm tools here. Kotlin is not run because there is no JVM or gradle. The jacoco reader is still checked in CI against the hand-written `coverage/jacoco.xml` (12 Kotlin functions, hit and missed lines chosen by hand) and by `sensors/tests/test_jacoco.py`.

### Scores recomputed by hand

Ten functions, at least two per language and two with unknown coverage. `K` lines of the function are instrumented and `h` are hit, so coverage is `h/K`; the score is `c^2 * (1 - cov)^3 + c`. The sensor column is the overlay value the corpus test reads.

| function | c | cov | arithmetic | hand | sensor |
| --- | --- | --- | --- | --- | --- |
| python `matching` | 7 | 0/7 | 49 x 1 + 7 | 56 | 56.0 |
| python `nested` | 10 | 3/7 | 100 x (4/7)^3 + 10 = 100 x 64/343 + 10 = 18.659 + 10 | 28.659 | 28.659 |
| python `mixed` | 9 | unknown | no instrumented line, CRAP at least 9 | none | none |
| typescript `logic` | 8 | 1/7 | 64 x (6/7)^3 + 8 = 64 x 216/343 + 8 = 40.303 + 8 | 48.303 | 48.303 |
| typescript `sprawl` | 12 | 3/6 | 144 x (1/2)^3 + 12 = 18 + 12 | 30 | 30.0 |
| kotlin `tryCatch` | 6 | 2/7 | 36 x (5/7)^3 + 6 = 36 x 125/343 + 6 = 13.120 + 6 | 19.12 | 19.12 |
| kotlin `wide` | 11 | 2/7 | 121 x (5/7)^3 + 11 = 121 x 125/343 + 11 = 44.096 + 11 | 55.096 | 55.096 |
| rust `if_else_if` | 3 | 0/5 | 9 x 1 + 3 | 12 | 12.0 |
| rust `match_three` | 5 | 5/7 | 25 x (2/7)^3 + 5 = 25 x 8/343 + 5 = 0.583 + 5 | 5.583 | 5.583 |
| rust `wide_match` | 9 | unknown | no instrumented line, CRAP at least 9 | none | none |

All ten agree. `typescript sprawl` sits exactly on the default threshold of 30 and is a finding, as the sensor's `>=` rule requires.

### Corpus against the sensor

All 48 labelled functions agree with the sensor: complexity, coverage, score and finding or no finding (16 findings, 32 without). No case carries a `known_defect`.

## Disagreements

Every non-matching function, classified.

| function | sensor | reference | classification | explanation |
| --- | --- | --- | --- | --- |
| python `matching` (`fixtures/crap/corpus/python/risk.py:53`) | 7 | radon 6 | definitional | The function has three `case` arms, one of them `case _`. REC-130 counts every `case_clause`, including `_`; radon counts the two refutable arms and not the wildcard (a minimal `match` with `case 1`, `case 2`, `case _` scores 3 in radon, 4 in the sensor). The sensor follows its own table. |
| rust `closure` (`fixtures/crap/corpus/rust/src/risk.rs:65`) | 7 | rust-code-analysis 8 | definitional | The function contains a closure with one `if`. REC-130 does not make a closure a unit, so its branch point counts in the enclosing function. rust-code-analysis makes the closure its own space with base 1 and adds that 1 to the enclosing function. |
| rust closure space (`risk.rs:66`) | no unit | rust-code-analysis 2 | reference | The reference reports the closure as a function of its own; the sensor does not treat closures as units, by design. |
| lightcycle `SqliteStore.transaction` (`lightcycle/adapters/sqlite_store.py:374`), `Config.set_personal_origin` (`lightcycle/config.py:848`), `node_read_surface` (`lightcycle/application/work/node_read_surface.py:8`) | 4, 4, 28 | radon 5, 5, 29 | definitional | Each has an `else` clause on a `try` or a `for`. radon adds 1 for the `else` of a loop or a `try` (a bare `for` scores 2 in radon and `for ... else` 3; the same for `try/except` with and without `else`); REC-130's table has no row for it, so the sensor adds nothing. These are the only 3 of 3306 lightcycle functions that differ. |
| typescript `base-store.ts:6`, `:7`, `:8` (`fixtures/typescript/sample/api/src/base-store.ts`) | no unit | eslint 1 each | reference | These are the class fields `ids`, `size` and `cursor`; eslint 9 reports a class field initializer as a code path of complexity 1. They are not functions. |

No disagreement is a defect by REC-130's own rule.

Outside the compared set: radon adds 1 for each `assert` statement and the sensor adds nothing, seen on the corpus's native test file (`native/python/test_risk.py`, four test functions the sensor scores 1 and radon 5 to 7). That is definitional too and is why the comparison covers the corpus source folders, not the whole corpus folder.

## Defects to file

None found. To close the `incomplete` verdict the driver runs, in this order: the Kotlin complexity (needs detekt and a JVM) and jacoco coverage, and the Rust `cargo llvm-cov` coverage (needs a rustup toolchain where `llvm-tools-preview` installs). The lightcycle complexity run is done.
