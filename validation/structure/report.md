# Structure warnings validation

## Verdict

**incomplete.** Every hand-computed metric (136 values over 17 folders) and 33 of the 34 labelled cases agree with the sensor, and the Python scanner's import graph matches grimp's once re-exports are accounted for; but one real defect was found (a ring of three or more folders is not reported), and the structure run over lightcycle's scan did not run. The sensor needs a `fix` for the ring before it is trusted for cycles.

## Method

- Recognizer commit `1dbb09c`; lightcycle commit `c1933e0`.
- Corpus: `fixtures/structure/corpus/`, eight small hand-written descriptions of a scan (modules with their exported kinds, and edges) and `expected.json`. `check/test/structure-corpus.test.ts` expands each into a scan, runs `structureSensor` with only the warning under test on, and compares the finding ids and `evidence.measures` and the folder metric rows to the hand-computed values. Settings that turn warnings off are the test's, so each scan can only produce its own kind of finding.
- Reference tool: grimp 3.18 (`pydeps` was not needed, grimp loaded the package). The Python scanner is `scanners/python`.
- Scripts: `validation/structure/folder-metrics.mjs` (prints the table below from `check/dist`, so run `npm run build -w recognizer` first) and `validation/structure/grimp_compare.py --repository <path> --package <name> [--source-root <dir>] --scanner "uv run --project scanners/python recognizer-scan-python"`, run with a Python that has grimp.

## Comparisons

### Warnings against hand labels

34 cases: 5 cycle, 3 hub, 4 folder cycle, 7 orphan, 4 stable dependencies, 11 stable abstractions (pain, useless, exactly at the threshold, null instability, null abstractness, main sequence). For each warning kind there is a case that must fire and a near miss that must not: the two-module cycle and the ring of three against a chain, a self-import and a cycle only through a foreign node; hub 10 and 10 against 10 and 9 and 9 and 10; the folder cycle against a one-way dependency and two nested folders; the orphan against a test file, an `__init__`, a literal policy path and an `entry_points` match; stable dependencies against the reverse direction and equal instability; the worked example at thresholds 0.3 and 0.3333, where `core` has D = 0.3333 and warns only at the lower threshold because the rule is strictly greater.

| result | count |
| --- | --- |
| cases that agree | 33 |
| cases that disagree | 1 (the ring of three folders) |
| findings the sensor produced that no label expects | 0 |

### Folder metrics, hand-computed beside the sensor's

The hand column is `expected.json`; the sensor column is `measureFolders` output. All 136 values (8 fields over 17 folders) agree.

| scan | folder | Ca | Ce | I | A | D |
| --- | --- | --- | --- | --- | --- | --- |
| worked-0.3 | app | 0 = 0 | 1 = 1 | 1 = 1 | 0 = 0 | 0 = 0 |
| worked-0.3 | core | 1 = 1 | 2 = 2 | 0.6667 = 0.6667 | 0 = 0 | 0.3333 = 0.3333 |
| worked-0.3 | infra | 2 = 2 | 0 = 0 | 0 = 0 | 0.5 = 0.5 | 0.5 = 0.5 |
| stable-dependencies | tx | 0 = 0 | 1 = 1 | 1 = 1 | null = null | null = null |
| stable-dependencies | ty | 0 = 0 | 1 = 1 | 1 = 1 | null = null | null = null |
| stable-dependencies | t | 2 = 2 | 1 = 1 | 0.3333 = 0.3333 | null = null | null = null |
| stable-dependencies | u | 1 = 1 | 1 = 1 | 0.5 = 0.5 | null = null | null = null |
| stable-dependencies | v | 1 = 1 | 0 = 0 | 0 = 0 | null = null | null = null |
| stable-dependencies | e0 | 0 = 0 | 1 = 1 | 1 = 1 | null = null | null = null |
| stable-dependencies | e1 | 1 = 1 | 1 = 1 | 0.5 = 0.5 | null = null | null = null |
| stable-dependencies | e2 | 1 = 1 | 1 = 1 | 0.5 = 0.5 | null = null | null = null |
| stable-dependencies | e3 | 1 = 1 | 0 = 0 | 0 = 0 | null = null | null = null |
| zones | ux | 0 = 0 | 1 = 1 | 1 = 1 | 1 = 1 | 1 = 1 |
| zones | uy | 1 = 1 | 0 = 0 | 0 = 0 | 0 = 0 | 1 = 1 |
| zones | iso | 0 = 0 | 0 = 0 | null = null | 0 = 0 | null = null |
| zones | nx | 0 = 0 | 1 = 1 | 1 = 1 | null = null | null = null |
| zones | ny | 1 = 1 | 0 = 0 | 0 = 0 | 1 = 1 | 0 = 0 |

### Import graph against grimp (lightcycle)

The build ran this once so that the report has real figures; the driver re-runs it and takes over the classification (acceptance item 10). Scanner edges exclude `inferred` edges (a guess from method calls, not an import), as the structure sensor does.

| set                         | edges |
| --------------------------- | ----- |
| scanner (`scanners/python`) | 1417  |
| grimp                       | 1309  |
| intersection                | 1124  |
| only in the scanner         | 293   |
| only in grimp               | 185   |

Classification of the edges in only one set:

| class | edges | explanation |
| --- | --- | --- |
| re-export through a package `__init__.py` | 282 scanner-only, 181 grimp-only | The scanner follows an imported name through `__init__.py` to the module that defines it (documented in the scanner README), so `from lightcycle.domain.work import State` is an edge to `domain/work/state.py`; grimp stops at `domain/work/__init__.py`. Each of the 282 scanner-only edges pairs, by importer and package, with a grimp-only edge to that package's `__init__.py`; one import of several names can fan out to several defining modules, which is why 282 pairs with 181. |
| re-export through a module that is not an `__init__` | 4 scanner-only, 4 grimp-only | The same behaviour through `lightcycle/config.py` and `lightcycle/adapters/tui/hub.py`: `tick.py` imports `RELOAD_RELOADED` from `config.py`, grimp records `config.py` and the scanner records `config_reload.py`. The four grimp-only edges are to `hub.py` and `config.py`. |
| not read | 7 scanner-only | `commands/setup.py` to `config_reload.py`, `application/feedback/hold_comment.py` to `domain/feedback/trust.py`, `application/feedback/retro_scope.py` to `domain/feedback/reflection.py`, `application/feedback/worklog.py` to `domain/feedback/worklog.py`, `application/pool/schedule_cadence.py` to `domain/schedule/state.py`, and `application/work/automation.py` to `domain/feedback/retro.py` and `domain/feedback/trust.py`. They fit the re-export pattern but were not opened, so a `TYPE_CHECKING`, relative or dynamic import among them is not ruled out. |

No one-sided edge was identified as a `TYPE_CHECKING`, dynamic or relative import. The driver reads the seven and re-runs the comparison.

### The structure sensor over lightcycle's scan

Not run: the cycles, hubs and orphans of the structure sensor over lightcycle's scan, and whether grimp agrees with each, are left to the driver (acceptance item 10).

## Disagreements

| item | classification | note |
| --- | --- | --- |
| ring of three folders `ra -> rb -> rc -> ra`, no two modules cyclic | defect | `folderCycleFindings` reports only pairs of folders that import each other, and `analyse` reports only cycles of modules, so a ring of three or more folders returns no finding (`folder-cycle/ring-of-three-folders`, `known_defect: pending-filing`) |
| scanner and grimp differ on re-exported names | definitional | the scanner follows the name to its defining module by design; grimp reports the module imported |
| `sensors/src/recognizer_sensors/mutation/record.py` imports `recognizer_sensors.mutation.test_files`; the scanner records an edge to `mutation/__init__.py`, grimp to `mutation/test_files.py` | defect (candidate) | found by running `grimp_compare.py` on the recognizer sensors package; `test_files.py` is a source module whose name matches the scanner's skipped test-file glob `test_*.py`, so it is absent from the scan and the import falls back to the package |

## Defects to file

1. **Folder cycles through three or more folders are not reported.** Where: `folderCycleFindings` in `check/src/structure-warnings.ts` and `analyse` in `check/src/analyse.ts`. Evidence: the corpus case `folder-cycle/ring-of-three-folders` (six modules, edges `ra/x.ts -> rb/x.ts`, `rb/y.ts -> rc/x.ts`, `rc/y.ts -> ra/y.ts`), run at `1dbb09c`. Suggested size: small to medium (find strongly connected components of the folder graph, then clear the case's `known_defect`).
2. **A source module named `test_*.py` is skipped by the Python scanner.** Where: the scan selection's `skip_file_globs` (`test_*.py`) as applied by `scanners/python`. Evidence: `sensors/src/recognizer_sensors/mutation/test_files.py` is not a test and is missing from the scan, so the import of it from `record.py` is attributed to the package `__init__.py`. Suggested size: small; the decision is whether to skip by name at all or only in test directories, which is a question for Ken.
