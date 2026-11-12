# Measurement corpus

Findings rules and thresholds are measured across many real repositories, never tuned on one. `manifest.json` lists the repositories; `snapshot.mjs` fetches each at its pinned commit and records what the released `recognizer` makes of it.

Every source must be a reputable, well-maintained project, small to medium sized where it can be, or one of Ken's own repositories. Nothing here is a toy or a fixture.

## Manifest

`manifest.json` is an array with one entry per repository: `name` (also its folder name), `upstream` (a clone URL), `commit` (the full 40-character SHA), `languages` (any of `python`, `typescript`, `rust`, `kotlin`, `csharp`: the scans to keep and check) and `why` (one line on why it is in the corpus). The pinned commits are those of the 2026-11-06 snapshot. Ken's repositories are cloned over HTTPS, so the machine needs access to them.

## Running

```sh
node validation/corpus/snapshot.mjs [--out <folder>] [--only <name>[,<name>...]] [--date <YYYY-MM-DD>] [--keep-clones]
```

The output folder defaults to `~/recognizer-corpus`, and must be outside the Recognizer repository. The script prints the snapshot folder. It runs the `recognizer` on `PATH`.

A snapshot is `<out>/<date>/` holding `commits.txt`, `recognizer-version.txt` and one folder per repository with `scan.<language>.json`, `check.<language>.json` and `.err` (from `recognizer check --scan`) and `structure.json` (the structure findings `recognizer scan` wrote, duplication check included, at default settings). A repository whose fetch or scan fails gets an `error.txt` and the run continues; the script's last line names them.

Each repository is fetched with a depth-1 fetch of its pinned commit into `<out>/repos/<name>`. A clone the run made is deleted once its snapshot is written, unless `--keep-clones` is given, so a full run leaves only the snapshots. A clone already present at the right commit is reused and left in place.

Only `recognizer scan` (structure only, no `--describe`, no `--sense`), and `recognizer check --scan` run. Nothing from a cloned repository is built, tested, installed or executed.

## Adding a repository

Append an entry to `manifest.json` with its pinned commit, run `node validation/corpus/snapshot.mjs --only <name>`, and read its snapshot folder before relying on it. The tests in `snapshot.test.mjs` run without network access.

## Comparing Python source roots

```sh
node validation/corpus/source-roots-compare.mjs [--only <name>[,<name>...]]
```

For each Python entry in the manifest the script fetches the pinned commit into a temporary folder outside the repository, scans it with `recognizer-scan-python --source-root .` (the old default) and with no flag (detected source roots), runs `recognizer check --scan` on each, and prints one row per repository and run: modules, in-repo edges, foreign self-edges (edges to `foreign:<name>` where `<name>` is a package of the repository), and the `hub` and `orphan` finding counts. The clones are deleted when it finishes. It runs the `recognizer` and `recognizer-scan-python` on `PATH`; nothing from a clone is built, tested, installed or executed. Its offline test is `source-roots-compare.test.mjs`.

## Duplication equivalence

```sh
node validation/corpus/duplication-equivalence.mjs [--out <folder>] [--only <name>[,<name>...]] [--runs <n>]
```

For each manifest repository, and for lightcycle at `c1933e0` in its own `lightcycle-c1933e0` clone, the script compares the duplication findings the structure sensor writes with the ones the Python sensor wrote at the base commit (`recognizer-sensors duplication`), by id and by record. A finding in a file the port skipped as invalid UTF-8 is a difference with that cause; any other difference fails the run.

The lightcycle row expects 45 Python findings. That figure is the base sensor at its defaults, not the 533 pairs the REC-182 review counted at `8f6a858e`: later commits report one finding per group, skip constructor and accessor shapes and raise `pair_min_lines` to 6.

`added` is the cold cost: the duplication unit cache is deleted before each timed run with duplication on, and the median is taken against runs with it off. `warm` is the same figure with the cache kept. The off runs write a one-key `.recognizer/config.yaml` into the clone and restore the repository's own file afterwards.
