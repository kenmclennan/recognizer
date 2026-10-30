# recognizer check

Reads a scan and an optional policy, reports the dependency violations against a committed baseline that may only shrink, and reports graph metrics and warnings computed from the scan alone.

```sh
recognizer check --scan <scan.json> [--policy <policy.yaml>] [--hub-threshold <n>]
```

Without `--policy` no violations are computed and no baseline is read or written; only warnings and metrics are reported.

## Policy

YAML with the keys `components`, `levels`, `uses`, `forbid`, `foreign` and `ignore`; any other key is an error. `levels` and `uses` are optional, and a policy with neither checks only `forbid`.

- `components` maps a component name to one glob or a list of globs. A module matching globs of two components is an error. A module matching none is unranked: never compared, and reported as a count of distinct ids.
- `levels` lists component names, inner first. A component may depend on itself or any inner one; an edge from an inner component to an outer one is a violation.
- `uses` maps a component name to the list of component names it may depend on. It is a per-component table, not transitive: permission to use `b` does not extend to what `b` uses.
- `forbid` is a list of `<from-glob> -> <to-glob>` strings over full module ids, such as `lightcycle/adapters/* -> lightcycle/adapters/*`. The target may be a `foreign:` id.
- `foreign` groups external libraries. It is validated and otherwise left to the viewer.
- `ignore` is a list of globs; matching modules, and every edge touching them, are dropped before checking.

Every name in `levels` and every key and value in `uses` must be a key of `components`; each fault is reported. `depends`, `inherits` and `implements` edges are all subject to the component rule.

### The component rule

For an edge between two different components, after `ignore`: it is permitted when both components are in `levels` and the source is outer to the target, or when `uses` lists the target for the source. Any other edge is a violation. Its rule is `level` when both components are in `levels`, and `uses` otherwise. Two modules of one component are never compared, and a module in no component is unranked.

Example: `components` domain, ports, application, extras; `levels: [domain, ports, application]`; `uses: {domain: [ports], extras: [domain]}`.

| Edge                  | Result                                            |
| --------------------- | ------------------------------------------------- |
| application -> domain | permitted: outer to inner                         |
| domain -> ports       | permitted: the order forbids it, `uses` allows it |
| domain -> application | violation, rule `level`                           |
| extras -> domain      | permitted by `uses`                               |
| extras -> ports       | violation, rule `uses`                            |
| domain -> extras      | violation, rule `uses`                            |

There is no allow list: `uses` states which components may depend on which, and cannot exempt a single violating edge. Existing violations go in the baseline.

Foreign nodes are never violations unless a `forbid` names them. A self-edge is never a violation. Edge endpoints missing from the scan's `modules` are still checked.

### Starter policies

[`policies/`](../policies) holds two complete, commented policies to copy into `.recognizer/policy.yaml`: `hexagonal.yaml` (the levels form) and `vertical-slices.yaml` (the uses form).

### Globs

Globs match the whole id, case-sensitive.

| Token | Matches |
| --- | --- |
| a pattern that is exactly `*` or `**` | every id, including `foreign:` ids |
| `**/` | zero or more leading directories |
| `/**` at the end | the directory itself or anything below it |
| `**` elsewhere | any characters, including `/` |
| `*` | any characters except `/` |
| `?` | one character except `/` |
| anything else | itself, literally |

## Edges that are read

A scan must carry `schema_version` 5; a version-1 scan is refused with exit `2`. Edges that carry `inferred` are read from the scan and ignored by every output: violations, `unranked`, metrics and warnings are computed from the other edges only. A later item decides whether inferred edges count.

## Violations and the baseline

A violation is identified by `from`, `to` and `kind`, never by line. Edges sharing that identity collapse into one violation carrying all its lines and every rule that fired.

The baseline lives at `.recognizer/baselines/violations.json` in the scanned repository, or at `--baseline`:

```json
{
  "schema_version": 1,
  "violations": [
    {
      "from": "shop/domain/order.py",
      "to": "shop/adapters/memory_store.py",
      "kind": "depends"
    }
  ]
}
```

`violations` is sorted by `from`, `to`, then `kind` by code unit, with no duplicates; an unsorted, duplicated or unknown-version file is rejected. A missing baseline is treated as empty.

`new` is the violations not in the baseline. `fixed` is the baseline entries that no longer occur; they never fail a run.

## Flags

- `--baseline <path>`: default `baselines/violations.json` beside the policy file.
- `--update-baseline`: rewrites the baseline without the fixed entries. It never adds: with any new violation it writes nothing and exits 1. A missing baseline is exit 2.
- `--init-baseline`: creates the baseline from every current violation. An existing baseline is exit 2.
- `--hub-threshold <n>`: default `10`; an integer of at least 1, anything else is exit 2. See Warnings and metrics.
- `--baseline`, `--update-baseline` and `--init-baseline` without `--policy` are exit 2.
- The two baseline flags together are exit 2. Without one, nothing is ever written.

## Output

Stdout holds one JSON document, the human summary goes to stderr.

```json
{
  "violations": [
    {
      "from": "",
      "to": "",
      "kind": "depends",
      "lines": [4],
      "rules": [
        { "type": "level", "from_level": "domain", "to_level": "adapters" }
      ]
    }
  ],
  "new": [],
  "fixed": [{ "from": "", "to": "", "kind": "depends" }],
  "unranked": 0,
  "baseline": { "path": "", "present": true, "action": "none" },
  "thresholds": { "hub": 10 },
  "warnings": [],
  "metrics": []
}
```

`rules` entries are `{"type": "level", "from_level", "to_level"}`, `{"type": "uses", "from_component", "to_component"}` or `{"type": "forbid", "pattern"}`; the sample shows the first, and a `uses` entry reads `{ "type": "uses", "from_component": "orders", "to_component": "billing" }`. `action` is `none`, `initialised` or `shrunk`. Without `--policy` the first five keys are absent and the document is `thresholds`, `warnings`, `metrics`. The human summary on stderr ends with a `warnings: N` line.

## Warnings and metrics

Metrics are computed per module from the scan alone, over distinct modules after `ignore`, with self-edges dropped. Foreign nodes carry no metrics. A ratio with a zero denominator is `null`, never `0`.

- `fan_in`: the number of distinct other modules with an edge to the module.
- `fan_out`: the number of distinct other modules the module has an edge to, foreign targets excluded.
- `afferent`: equal to `fan_in`.
- `efferent`: `fan_out` plus the distinct foreign targets of the module.
- `instability`: `efferent / (afferent + efferent)` rounded to four decimals, `null` when both are 0.
- `abstractness`: 1 when the module's `kind` is `interface`, otherwise 0.

A warning is a graph heuristic reported as a candidate with evidence, never a verdict. Warnings are never baselined and never affect the exit code. Each carries `id`, `principle`, `fix_pattern`, a one-line `summary` and `evidence`, and they are sorted by `id` then by module.

| id      | principle                            | fix pattern   |
| ------- | ------------------------------------ | ------------- |
| `cycle` | `no-cycles`                          | `break-cycle` |
| `hub`   | `interfaces-are-narrow-and-explicit` | `split-hub`   |

- `cycle`: a strongly connected component of two or more modules; evidence is its sorted `modules` and the `edges` inside it.
- `hub`: a module whose `fan_in` and `fan_out` are both at or above `--hub-threshold` (default `10`); evidence is `module`, `fan_in`, `fan_out` and `threshold`.
- `break-cycle`: the fix pattern for `cycle`, naming the change that removes at least one edge of the cycle.
- `split-hub`: the fix pattern for `hub`, naming the change that divides the module so that no part is both widely used and widely dependent.

The in-effect thresholds are printed as `thresholds` in the output. They are command-line flags only; the policy carries no warnings key.

## Exit codes

- `0`: no new violation, or no policy. Warnings never change the exit code.
- `1`: at least one new violation.
- `2`: bad input - an unreadable or invalid scan, policy or baseline, an unknown or conflicting flag, `--init-baseline` over an existing file, or `--update-baseline` without one.

## recognizer scan

`recognizer scan [REPOSITORY] [--json]` scans a repository: it detects its languages, runs each language's standalone scanner as a separate process, validates the result and writes one scan per language to `<repository>/.recognizer/cache/`. `REPOSITORY` defaults to the current directory. Scans are never merged. A scanned repository should gitignore `.recognizer/cache/`.

### Detection

The repository is walked depth-first, skipping directories named `.git`, `node_modules`, `.venv`, `venv`, `dist`, `build`, `.worktrees` and `.recognizer` at any depth; directory symlinks are not followed. A language is detected only where its scanner would look: Python on a `.py` file outside directories its scanner skips (`__pycache__`, `tests`, `site-packages`, dot directories, `*.egg-info`, virtual environments) and not a test file (`test_*.py`, `*_test.py`, `*_tests.py`, `conftest.py`); TypeScript on a file named `tsconfig.json` or a `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs` or `.cjs` file outside `test`, `tests`, `__tests__` and dot directories, and not a `.d.ts`, `*.test.*` or `*.spec.*` file; Kotlin on a `.kt` file outside `build` and dot directories (a Gradle or Maven build file alone detects nothing); Rust on a `.rs` file outside `target`, `node_modules` and dot directories (a `Cargo.toml` alone detects nothing). A JavaScript-only repository is therefore scanned by the TypeScript scanner. The shared `fixtures/selection-parity.json` tree is checked against detection as well as against the scanners. A repository may be both. With no language detected nothing is run and `no languages detected` goes to stderr.

### Scanners and overrides

Each detected language runs `<scanner> <repository> --output <temporary file>`, plus `--commit <sha>` when `git -C <repository> rev-parse HEAD` succeeds. The scanner is `recognizer-scan-python`, `recognizer-scan-typescript`, `recognizer-scan-kotlin` or `recognizer-scan-rust`, found on `PATH`, unless an environment variable names one absolute executable path instead: `RECOGNIZER_SCAN_PYTHON`, `RECOGNIZER_SCAN_TYPESCRIPT`, `RECOGNIZER_SCAN_KOTLIN` or `RECOGNIZER_SCAN_RUST`. An empty variable is treated as unset; a relative one fails the language with `invalid-override`. A checkout's scanners need a launcher (`uv run --project scanners/python recognizer-scan-python`, `node scanners/typescript/dist/bin.js`, `uv run --project scanners/kotlin recognizer-scan-kotlin`, `cargo run --release --manifest-path scanners/rust/Cargo.toml --`), so point the variable at a small executable script that runs it. No scanner is published yet, so install them from a checkout.

### Scan output

The scan is validated, then its bytes are copied unchanged to `.recognizer/cache/scan.python.json` or `.recognizer/cache/scan.typescript.json`. A language that is not detected leaves no file, and a stale file for it is removed; a language that fails removes its own old file. Other files in the cache, such as overlays, are untouched. Stdout has one line per written language, such as `python: 14 modules, 19 edges -> .recognizer/cache/scan.python.json`; failures and removals go to stderr, prefixed with the language.

`--json` makes stdout one document with `repository`, `commit` (a string or `null`), `languages` and `removed`. Each language is `{ language, status: "written", modules, edges, file }` or `{ language, status: "failed", reason, message }`. The reasons are `not-installed`, `invalid-override`, `scanner-failed`, `invalid-scan` and `unknown-schema-version`. `removed` lists the absolute paths deleted.

### Scan exit codes

- `0`: every detected language was written, or none was detected.
- `1`: at least one detected language failed; the others still run and are written.
- `2`: bad usage - an unknown flag, more than one `REPOSITORY`, or a `REPOSITORY` that is not a directory.

## recognizer open

`recognizer open [FOLDER]` opens a folder in the Recognizer viewer. `FOLDER` defaults to the current directory and is resolved to an absolute path. The viewer is the `Recognizer.app` bundle: the command uses `$RECOGNIZER_APP` when it is set and non-empty (an absolute path to a `.app` bundle), otherwise `~/Applications/Recognizer.app`, then `/Applications/Recognizer.app`. It starts the bundle's single executable in `Contents/MacOS` detached, with the folder as its one argument, and returns without waiting. Starting the executable directly lets a running viewer receive the folder, which `open -a` does not.

- `0`: the viewer was started.
- `1`: the environment is wrong - no bundle was found (the message says to run `npm run install-app` from a checkout), `Contents/MacOS` does not hold exactly one executable, or the launch failed.
- `2`: bad input - more than one `FOLDER`, a `FOLDER` that is not a directory, or a `RECOGNIZER_APP` that is not an absolute path to a `.app` bundle.

### Installing the command

`brew install kenmclennan/tap/recognizer` installs `recognizer` and the Python and TypeScript scanners; `recognizer --version` and each scanner's `--version` print the toolchain version. From a checkout, `npm run build -w recognizer`, then `npm install --global ./check` puts a `recognizer` executable on the npm prefix's `bin`.

## The command table

`check/src/commands.ts` exports `COMMANDS`, the one list `recognizer` dispatches from and `check/src/help.ts` renders help from. Each entry holds a command's name, one-line summary, usage, arguments, options, what it prints as text and with `--json`, exit codes and examples. `recognizer --help` prints every command with its one line; `recognizer help <command>` and `<command> --help` print the full entry. The table holds `check`, `scan`, `open`, `uses`, `used-by`, `callers`, `path` and `help`.

## Question commands

`recognizer uses <module>`, `recognizer used-by <module>`, `recognizer callers <module> <name>` and `recognizer path <from> <to>` answer what the canvas and the Dependencies tab show. Modules are named by repository-relative path, `--repository <dir>` (default `.`) picks the repository, text is the default and `--json` prints JSON. A question's stdout holds only its answer.

- `uses` and `used-by` list the modules grouped by folder, each with the names used, marked `(private)` or `(inferred)`. Exit 0, including for no modules.
- `callers` lists the modules that call a member, with `(through <Abstraction>)` for a call that reaches it by dispatch, and whether the member is built. A module with no call data in the scan is exit 2, never "no callers".
- `path` finds the shortest chain of `uses` edges, visiting neighbours in id order. Exit 0 when a path exists (including from a module to itself), 1 when none does.
- An unknown module, a wrong argument count or a scan that could not be made is exit 2.

### Freshness

A question uses the cached scans when every detected language has a cache taken at the current commit and the working tree is clean, ignoring everything under `.recognizer/`. Otherwise it runs `recognizer scan` first, with the scan summary on stderr. The rule is the library function `freshScans` in `check/src/freshness.ts`, which is not exported from the index because it spawns `git`. A cache is reused only when it records `modified: false` and every file in its `files` still has the recorded SHA-256, so a cache written from a dirty tree is not reused after the edits are reverted. A version-3 cache fails validation and is rescanned.

## Library

`import { check, analyse, parsePolicy, parseBaseline, serialiseBaseline, validateScan, collectViolations, SCAN_SCHEMA_VERSION, InputError } from "recognizer"`. `check(scan, policy, baseline)` takes a parsed scan, the result of `parsePolicy` and a parsed baseline or `null`, and performs no IO. `collectViolations(scan, policy)` returns `{ violations, unranked }` for a validated scan, and `SCAN_SCHEMA_VERSION` is the schema version the library reads. The scan validator is built on the first call of `validateScan`, so importing the library compiles nothing and loads where code generation from strings is forbidden. The neighbour, grouping, caller and path functions the viewer and the question commands share (`usesOf`, `usedByOf`, `groupByFolder`, `buildCallerIndex`, `shortestPath` and the rest of `neighbours.ts`, `callers.ts` and `paths.ts`) are pure and import nothing from `node:`. `analyse(scan, { hub }, ignore)` takes a validated scan and returns `{ thresholds, warnings, metrics }`. Only `nodeIo` in `cli.ts` touches the filesystem, and spawning processes is confined to it too.

## recognizer views

`recognizer views <subcommand>` builds, shows and checks saved views: files at `.recognizer/views/<name>.json` that record a description, the commit they were saved at and steps. A name is letters, digits, `-` and `_`, at most 64. Every subcommand takes `--repository <dir>` and `--json`; the scan is read from cache when fresh and made first otherwise, and a triggered scan's summary goes to stderr.

The file is `{ schema_version: 1, description, commit, steps }`, described by [`schema/view.schema.json`](../schema/view.schema.json) with examples in `schema/view-examples/`. A step is one of `pick` (a module), `rule` (`folder`, or `uses` / `used-by` of a module, optionally `within` a folder), `fold`, `focus` (at most one) or `left-out` (a module a rule put there). No layout or selection is stored.

`resolveView(view, scans)` and `validateView(value)` are exported from the library. Resolution gives the modules the steps put on the canvas now, the folded folders, the focus, and `unresolved`: the steps naming a path that no longer exists. A left-out removes a module a rule contributed, never a picked one.

| Subcommand | What it does |
| --- | --- |
| `new <name> --description <text>` | create an empty view saved at HEAD (`commit` is `null` outside git); reads no scan |
| `add <name> <module>...` | pick modules; all must exist or none are added; drops a left-out for each |
| `rule <name> (--folder <f> \| --uses <m> \| --used-by <m>) [--within <f>]` | append a rule |
| `fold <name> <folder>`, `focus <name> <folder>` | append a fold; set the one focus |
| `remove <name> <path> [--fold \| --focus \| --rule <relation> [--within <f>]]` | take a module off (its pick is deleted, and a left-out recorded if a rule still puts it there), or delete that step |
| `show <name>` / `show --current` | steps and what they resolve to now; the view the app has open, read uninterpreted from `.recognizer/cache/current-view.json` (exit 1 when there is none) |
| `list`, `rm <name>` | list views; delete one; neither reads a scan |
| `check [<name>] [--fix]` | list steps naming a path that no longer exists; `--fix` rewrites picks whose files git records as renamed since the view's commit |

A step already present is a no-op (`changed: false`). `commit` is written only by `new`. `check` exits 1 when any step is unresolved or a file is invalid after `--fix`; bad input is exit 2 and writes nothing. `--fix` sees only renames git has staged or committed (`git diff -M --relative --name-status --diff-filter=R <commit>`), never a plain `mv`.

## recognizer describe

`recognizer describe` writes each module's one-line responsibility with the describer a repository registers in `.recognizer/config.yaml`, and commits the lines to `.recognizer/responsibilities.json`. The scan never describes: no command except `describe` runs the describer. The scan is read from cache when fresh and made first otherwise; a triggered scan's summary goes to stderr.

`config.yaml` holds two keys, `describer` and `overlays` (see [recognizer measure](#recognizer-measure)), described by [`schema/config.schema.json`](../schema/config.schema.json) with examples in `schema/config-examples/`:

```yaml
describer:
  command: [node, "{repository}/scripts/describe.mjs", "{request}"]
  version: "2026-10-a"
```

`command` is run directly with no shell. In each item `{repository}` (the absolute repository path), `{module}` (the module id) and `{request}` (the path of a JSON request file) are replaced. `version` names the prompt; bump it to redo every line. The request is `{ module, kind, source, members, uses, used_by }`: the module's members from the scan, what it uses and what uses it (inferred rows flagged), and its source. The describer prints one line on stdout.

`responsibilities.json` is `{ schema_version: 1, modules }`, described by [`schema/responsibilities.schema.json`](../schema/responsibilities.schema.json) with examples in `schema/responsibilities-examples/`. Each module id maps to its `line`, the SHA-256 `source_hash` of the source it was written from, and the `describer` command (placeholders unfilled) and `version`. A line is current while all three match; another module's change does not outdate it. `validateResponsibilities`, `lineStatus` and `parseConfig` (which reads the describer from `config.yaml` text) are exported from the library.

| Form | What it does |
| --- | --- |
| `describe` | describe every module whose line is missing or out of date, one at a time in id order |
| `describe <module>...` | describe exactly the named modules, whatever their status |
| `describe --all` | describe every module |
| `describe --check [<module>...]` | run no describer and write nothing: print each module's status and line; exit 1 unless every module is current |

Each success is written at once, so a later failure keeps the lines already paid for. A describer that does not start, exits non-zero, prints nothing or prints more than one line leaves that module's entry as it was and is reported; the run exits 1 and the other modules are still processed. Entries for modules no longer in the scan are pruned by `describe` and listed under `gone` by `--check`. Bad input (no describer registered, an invalid config or file, an unknown module, `--all` with a module or with `--check`) is exit 2 and runs nothing. One run at a time is assumed: there is no lock.

## recognizer measure

`recognizer measure` runs the overlays a repository registers under `overlays` in `.recognizer/config.yaml` and writes one file per overlay to `.recognizer/cache/overlays/<name>.json`. It reads no scan and never runs a scan or a describer.

```yaml
overlays:
  coverage:
    command:
      [
        node,
        "{repository}/scripts/coverage.mjs",
        "{repository}",
        "{commit}",
        "{output}",
      ]
    metrics:
      - { name: line_coverage, type: ratio, granularity: module, bad: low }
```

An overlay name matches `^[a-z0-9][a-z0-9_-]*$`, at most 64 characters, because it becomes a file name. `command` is run directly with no shell, from the repository root. In each item `{repository}` (the absolute repository path), `{commit}` (the full HEAD hash) and `{output}` (the absolute path of the overlay file) are replaced. `metrics` declares each metric's `name` (unique within the overlay), `type` (`ratio`, `count`, `number` or `boolean`), `granularity` (`module` or `member`) and `bad` (`high` or `low`).

The overlay file is `{ overlay_version: 1, commit, modified, producer: { name, version }, metrics, values }`, described by [`schema/overlay.schema.json`](../schema/overlay.schema.json) with examples in `schema/overlay-examples/`. `values` maps each metric name to an object keyed by the scan's ids (`<module id>::<member>`, methods as `Class.method`). `validateOverlay` is exported from the library.

| Form | What it does |
| --- | --- |
| `measure` | run every registered overlay, one at a time, in config order |
| `measure <name>...` | run the named overlays, in the order named |

Before a command runs its old file is removed. A run fails when the command does not start, exits non-zero, writes no file, writes invalid JSON, or writes a file that fails validation: it must match the schema, carry the repository's `commit` and the `modified` state computed before any command ran, repeat the registered `metrics` exactly (in any order), hold values only for declared metrics, and give each value a suitable type (`ratio` a finite number from 0 to 1, `count` a non-negative integer, `number` a finite number, `boolean` a boolean). Value keys are not checked against any scan. A failed overlay is reported on stderr as `failed <name>: <reason>` and leaves no file; the other selected overlays still run. Exit 0 when every selected overlay was measured, 1 when any failed, 2 on bad input (no overlays registered, an invalid config, an unknown name, no commit).
