# recognizer-sensors

Recognizer's shipped sensors. Each reads the repository's cached scans and its working tree and writes one findings file (`schema/findings.schema.json`).

```sh
recognizer-sensors NAME [--repository P] [--commit C] [--output F] [--settings JSON]
```

`--repository` defaults to `.`, `--commit` to `git rev-parse HEAD`, `--output` to stdout and `--settings` to `{}`. Exit status is `2` for an unknown or missing name, a `--settings` that is not a JSON object or holds a bad or unknown key, a missing repository, no commit and any argument error. `--version` prints the package version, which is also the findings file's `sensor.version`.

A repository registers a shipped sensor in `.recognizer/config.yaml` by name: `sensors: {duplication: {}}`. `recognizer` expands that to `recognizer-sensors duplication --repository {repository} --commit {commit} --output {output} --settings <the mapping as JSON>`.

Install with `uvx --from ./sensors recognizer-sensors` or `pipx install ./sensors`. The names a sensor knows are listed in `fixtures/sensors/shipped.json`.

A sensor reports nothing for a file its grammars do not parse: a file with an extension no grammar covers is skipped, and so is a function whose syntax tree has an error node.

## duplication

Reports pairs of functions or methods in the same language whose structure is alike. A function is normalised (local names, parameter names, field names and literals become kind tokens; call names, operators and shape stay), every subtree down to depth 3 is hashed with SHA-1 and the set of hashes is the function's structural fingerprint. A pair is reported when the Jaccard similarity of the two sets is at or above `threshold`.

| setting | default | meaning |
| --- | --- | --- |
| `threshold` | `0.82` | a number above 0 and at most 1 |
| `min_lines` | `4` | functions with fewer lines are skipped (integer >= 1) |
| `min_nodes` | `20` | functions with fewer syntax nodes are skipped (integer >= 1) |

Each finding is a warning on both modules of the pair, with the fix pattern `extract-shared-function` and both functions as evidence members with `file` and `lines`. Written with unclebob/dryer (0BSD) as the reference, never a dependency.

Cost: scoring is quadratic in the number of functions per language, narrowed by a size filter and an inverted index on fingerprints; a very large repository may take minutes. The sensor runs only when asked (`recognizer scan --sense duplication`), never on open.
