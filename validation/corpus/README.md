# Measurement corpus

Findings rules and thresholds are measured across many real repositories, never tuned on one. `manifest.json` lists the repositories; `snapshot.mjs` fetches each at its pinned commit and records what the released `recognizer` makes of it.

Every source must be a reputable, well-maintained project, small to medium sized where it can be, or one of Ken's own repositories. Nothing here is a toy or a fixture.

## Manifest

`manifest.json` is an array with one entry per repository: `name` (also its folder name), `upstream` (a clone URL), `commit` (the full 40-character SHA), `languages` (any of `python`, `typescript`, `rust`, `kotlin`, `csharp`: the scans to keep and check) and `why` (one line on why it is in the corpus). The pinned commits are those of the 2026-11-06 snapshot. Ken's repositories are cloned over HTTPS, so the machine needs access to them.

## Running

```sh
node validation/corpus/snapshot.mjs [--out <folder>] [--only <name>[,<name>...]] [--date <YYYY-MM-DD>] [--keep-clones]
```

The output folder defaults to `~/recognizer-corpus`, and must be outside the Recognizer repository. The script prints the snapshot folder. It runs the `recognizer` and `recognizer-sensors` on `PATH`.

A snapshot is `<out>/<date>/` holding `commits.txt`, `recognizer-version.txt` and one folder per repository with `scan.<language>.json`, `check.<language>.json` and `.err` (from `recognizer check --scan`) and `duplication.json` (the shipped duplication sensor at default settings). A repository whose fetch, scan or sensor fails gets an `error.txt` and the run continues; the script's last line names them.

Each repository is fetched with a depth-1 fetch of its pinned commit into `<out>/repos/<name>`. A clone the run made is deleted once its snapshot is written, unless `--keep-clones` is given, so a full run leaves only the snapshots. A clone already present at the right commit is reused and left in place.

Only `recognizer scan` (structure only, no `--describe`, no `--sense`), `recognizer check --scan` and the duplication sensor run. Nothing from a cloned repository is built, tested, installed or executed.

## Adding a repository

Append an entry to `manifest.json` with its pinned commit, run `node validation/corpus/snapshot.mjs --only <name>`, and read its snapshot folder before relying on it. The tests in `snapshot.test.mjs` run without network access.
