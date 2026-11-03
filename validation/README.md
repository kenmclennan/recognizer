# Sensor validation

One folder per sensor with its `report.md` (verdict, method, comparisons, disagreements, defects to file) and the scripts that produced the comparisons. The labelled corpora the reports rest on are in `fixtures/<sensor>/corpus/`; they are checked in CI by `sensors/tests/test_corpus.py` and `check/test/structure-corpus.test.ts`. The reference tools are not CI dependencies, which is why nothing here is in a workflow path filter.

Every script takes `--repository` or tool paths so the lightcycle runs can be repeated without editing anything. Run the Python ones from `sensors/` so the sensors package is importable.

## crap

```sh
uv run python ../validation/crap/complexity.py --repository .. --prefix fixtures/crap/corpus/python --prefix fixtures/crap/corpus/typescript --prefix fixtures/crap/corpus/rust/src --radon <radon> --eslint <eslint> --rca <rust-code-analysis-cli>
uv run python ../validation/crap/coverage.py --python-venv <venv with coverage and pytest> --c8 <c8> --cargo-llvm-cov <cargo-llvm-cov>
```

`complexity.py` prints one JSON record per function with the sensor's value and the reference's; a tool left out is reported as not run. `eslint` must be an ESLint 9 install that also has `typescript-eslint`. `coverage.py` runs the corpus's native tests under each coverage tool and compares the sensor's per-function ratio with one recomputed from the tool's own JSON.

## mutation

```sh
PYTHONPATH=../validation/mutation uv run python ../validation/mutation/compare_python.py --repository <path> --source <file.py> --pytest <pytest file> --venv <venv with mutmut, coverage, pytest>
PYTHONPATH=../validation/mutation uv run python ../validation/mutation/compare_typescript.py --repository <path> --source <file.ts> --test <test file> --stryker <stryker> --c8 <c8>
```

Both copy the repository, run the reference tool and the sensor on the copy, and print each reference mutant with its bucket (matched, outside by design, inside the operator set but not generated), plus the sensor's survivors and counts. For mutmut the repository needs a pytest file that runs the tests; the corpus has `tests/test_shop.py` for that, and `--source app/shop.py` (Python) or `--source src/shop.ts --test tests/run.ts` (TypeScript) names the module.

## structure

```sh
node validation/structure/folder-metrics.mjs [--full]
/path/to/python-with-grimp validation/structure/grimp_compare.py --repository <path> --package <name> [--source-root <dir>] --scanner "uv run --project scanners/python recognizer-scan-python"
```

`folder-metrics.mjs` needs `npm run build -w recognizer` first. `grimp_compare.py` prints the edge counts of the scanner's and grimp's module graphs, their intersection and the edges in only one.

## thresholds

No script: the sensor reads overlays only and has no reference tool, so the CI test over the labelled corpus is the comparison.
