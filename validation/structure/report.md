# Structure warnings validation

## Verdict

**fix.** Every hand-computed metric (136 values over 17 folders) and 22 of the 23 labelled cases agree with the sensor, and the Python scanner's import graph matches grimp's once re-exports are accounted for; and the structure sensor's cycle, hubs and orphans over lightcycle's scan agree with grimp's graph (run by the driver after merge); but one real defect was found (a ring of three or more folders is not reported, REC-185). The sensor needs that `fix` before it is trusted for cycles.

## Method

- Recognizer commit `1dbb09c`; lightcycle commit `c1933e0`.
- Corpus: `fixtures/structure/corpus/`, eight small hand-written descriptions of a scan (modules with their exported kinds, and edges) and `expected.json`. `check/test/structure-corpus.test.ts` expands each into a scan, runs `structureSensor` with only the warning under test on, and compares the finding ids and `evidence.measures` and the folder metric rows to the hand-computed values. Settings that turn warnings off are the test's, so each scan can only produce its own kind of finding.
- Reference tool: grimp 3.18 (`pydeps` was not needed, grimp loaded the package). The Python scanner is `scanners/python`.
- Scripts: `validation/structure/folder-metrics.mjs` (prints the table below from `check/dist`, so run `npm run build -w recognizer` first) and `validation/structure/grimp_compare.py --repository <path> --package <name> [--source-root <dir>] --scanner "uv run --project scanners/python recognizer-scan-python"`, run with a Python that has grimp.

## Comparisons

### Warnings against hand labels

23 cases: 5 cycle, 3 hub, 4 folder cycle, 7 orphan, 4 stable dependencies. For each warning kind there is a case that must fire and a near miss that must not: the two-module cycle and the ring of three against a chain, a self-import and a cycle only through a foreign node; hub 10 and 10 against 10 and 9 and 9 and 10; the folder cycle against a one-way dependency and two nested folders; the orphan against a test file, an `__init__`, a literal policy path and an `entry_points` match; stable dependencies against the reverse direction and equal instability. Since sensor version 7 the stable-dependencies scans also have cases for a gap exactly on `instability_gap` and just under it, a folder named in `composition_roots` as the depending side and as the target, and a folder with only foreign imports, whose instability is unknown.

| result | count |
| --- | --- |
| cases that agree | 22 |
| cases that disagree | 1 (the ring of three folders) |
| findings the sensor produced that no label expects | 0 |

### Folder metrics, hand-computed beside the sensor's

The hand column is `expected.json`; the sensor column is `measureFolders` output. All 160 values (8 fields over 20 folders) agree; the three `folder-foreign-only` folders (`c` unknown, `d` 0, `e` 1) were added when foreign imports stopped counting as efferent coupling.

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
| folder-foreign-only | c | 0 = 0 | 0 = 0 | null = null | null = null | null = null |
| folder-foreign-only | d | 1 = 1 | 0 = 0 | 0 = 0 | null = null | null = null |
| folder-foreign-only | e | 0 = 0 | 1 = 1 | 1 = 1 | null = null | null = null |

### Import graph against grimp (lightcycle)

The build ran this once so that the report has real figures; the driver re-ran it on 2026-11-03 in a clean worktree at lightcycle `c1933e0` (1411 scanner edges, 1303 grimp, 1119 shared, 292 scanner-only, 184 grimp-only; the build's figures below differ by a few edges from its own checkout) and read the seven edges the build left unread. Scanner edges exclude `inferred` edges (a guess from method calls, not an import), as the structure sensor does.

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
| re-export through a chain of modules | 7 scanner-only | Read by the driver: each is the same behaviour through two hops. `commands/setup.py` imports `ConfigError` from `config.py`, which imports it from `config_reload.py`; `hold_comment.py` and `automation.py` import labels from `application/flow/engine_steps.py`, which re-exports them from `domain/feedback` (`retro.py`, `trust.py`); `retro_scope.py`, `worklog.py` and `schedule_cadence.py` reach `reflection.py`, `worklog.py` and `schedule/state.py` the same way. None is a `TYPE_CHECKING`, relative or dynamic import. |

No one-sided edge is a `TYPE_CHECKING`, dynamic or relative import. Every one-sided edge is the scanner resolving an imported name to the module that defines it, through any number of re-exports, where grimp records the module named in the import.

### The structure sensor over lightcycle's scan

Run by the driver on 2026-11-03 over the same clean worktree (`recognizer check`, defaults): 90 warnings, of which 1 cycle, 2 hubs, 4 orphans, 17 folder cycles, 33 unstable dependencies and 22 of a kind since retired. Checked against grimp's graph (the shared edges plus grimp's own):

| finding | sensor | grimp's graph | agrees |
| --- | --- | --- | --- |
| cycle `application/feedback/retro.py` with `retro_scope.py` | both edges | both edges | yes |
| hub `adapters/tui/hub_render.py` | fan-in 11, fan-out 17 | fan-in 9, fan-out 13 | on the modules, not the numbers: grimp counts imports of `hub.py`, which re-exports `hub_render.py`, against `hub.py`; under grimp's graph no module reaches 10 and 10 except two package `__init__.py` files |
| hub `application/flow/complete_step.py` | fan-in 10, fan-out 19 | fan-in 9, fan-out 18 | as above: one importer reaches it through a re-export |
| orphans (4: `__main__.py`, `worker_main.py`, `application/pool/no_op_gates.py`, `mutation_ratchet.py`) | no importer | no importer | yes, all four |

The hub counts differ only by the re-export rule already classified above; the sensor's edges name the defining module, so its fan-in is the number of modules that use something the module defines. A first pass with the scanner's `inferred` edges left in showed four importers of `no_op_gates.py`; those are method-call guesses, which the structure sensor and this comparison both exclude.

## Disagreements

| item | classification | note |
| --- | --- | --- |
| ring of three folders `ra -> rb -> rc -> ra`, no two modules cyclic | defect | `folderCycleFindings` reports only pairs of folders that import each other, and `analyse` reports only cycles of modules, so a ring of three or more folders returns no finding (`folder-cycle/ring-of-three-folders`, `known_defect` to be set to REC-185 by that fix) |
| scanner and grimp differ on re-exported names | definitional | the scanner follows the name to its defining module by design; grimp reports the module imported |
| `sensors/src/recognizer_sensors/mutation/record.py` imports `recognizer_sensors.mutation.test_files`; the scanner records an edge to `mutation/__init__.py`, grimp to `mutation/test_files.py` | defect (candidate, filed as REC-195 for a decision) | found by running `grimp_compare.py` on the recognizer sensors package; `test_files.py` is a source module whose name matches the scanner's skipped test-file glob `test_*.py`, so it is absent from the scan and the import falls back to the package |

## Defects to file

1. **Folder cycles through three or more folders are not reported.** Where: `folderCycleFindings` in `check/src/structure-warnings.ts` and `analyse` in `check/src/analyse.ts`. Evidence: the corpus case `folder-cycle/ring-of-three-folders` (six modules, edges `ra/x.ts -> rb/x.ts`, `rb/y.ts -> rc/x.ts`, `rc/y.ts -> ra/y.ts`), run at `1dbb09c`. Suggested size: small to medium (find strongly connected components of the folder graph, then clear the case's `known_defect`). Filed: REC-185.
2. **A source module named `test_*.py` is skipped by the Python scanner.** Where: the scan selection's `skip_file_globs` (`test_*.py`) as applied by `scanners/python`. Evidence: `sensors/src/recognizer_sensors/mutation/test_files.py` is not a test and is missing from the scan, so the import of it from `record.py` is attributed to the package `__init__.py`. Suggested size: small; the decision is whether to skip by name at all or only in test directories, which is a question for Ken. Filed: REC-195.
