# recognizer check

Reads a scan and an optional policy, reports the dependency violations against a committed baseline that may only shrink, and reports graph metrics and warnings computed from the scan alone.

```sh
recognizer check [<module>...] [--repository <dir>] [--policy <policy.yaml>] [--json]
recognizer check --scan <scan.json> [--policy <policy.yaml>]
```

Without `--policy` no violations are computed and no baseline is read or written; only warnings and metrics are reported.

`check` has two modes, chosen by `--scan`. With `--scan` it replays one scan document exactly as it always has: the report document on stdout, the summary on stderr, no module arguments, no `--json`, no `--repository`. Without `--scan` it checks the repository's current scan (the same freshness rule as the question commands, so a stale cache is rescanned first and the scan summary goes to stderr). The policy is `--policy`, else `.recognizer/policy.yaml` when it exists, else none. Each language's scan is checked on its own and the results are merged: `new` and `fixed` are computed once against the baseline over the union, so one language's baseline entries are not fixed because another scan lacks them. Output is text on stdout by default (the summary lines plus one `warning:` line per warning) and the report document with `--json`; the summary is not repeated on stderr. Module arguments narrow the report to violations touching them, warnings naming them and their metrics, and the exit code follows the narrowed set; they cannot be combined with `--update-baseline` or `--init-baseline`.

## Sensors and findings

A sensor judges and writes findings; `recognizer scan --sense` runs the registered and the shipped ones, and `check` runs the structure sensor and reports from the current findings files of the structure sensor, the registered sensors and the shipped sensors. Each sensor writes one document at `.recognizer/cache/findings/<name>.json`, described by [`schema/findings.schema.json`](../schema/findings.schema.json) with examples in `schema/findings-examples/`: `findings_version` 1 or 2 (a shipped sensor writes 2, which adds `inputs`, the scan's file hash of each module it measured, and for a sensor that depends on tests `tests`, a sha256 over the test files), `sensor` (`name`, `version`), `commit`, `modified`, `settings` and `findings`. A finding has a stable `id`, `kind`, `severity` (`violation` or `warning`), `principle`, `summary`, `evidence` (`modules`, and where they apply `edges` with `lines` and `rules`, `members`, `measures` and `test_importers`) an optional `fix_pattern` and an optional `metric` naming the metric a finding is about (a thresholds finding also carries `evidence.producer`, the overlay's producer). Ids are unique within a document. The structure sensor's ids are `rule-violation:<edge kind>:<from>-><to>`, `cycle:<sorted modules joined by ",">`, `orphan:<module>`, `unused_exports:<module>`, `private_imports:<module>` and `long_function:<function identity>`.

The structure sensor (`check/src/structure-sensor.ts`) is built in. It is configured in `.recognizer/config.yaml` under `sensors.structure`, and any other entry under `sensors` registers a command:

```yaml
sensors:
  structure:
    warnings:
      cycle: true
      unused_exports: false
      private_imports: true
      long_function: true
      orphan:
        entry_points: ["packages/*/src/main.ts", "scripts/**"]
  unused:
    command: [node, "{repository}/scripts/unused.mjs", "{commit}", "{output}"]
```

A shipped sensor registers in a short form: an entry whose value is a mapping with no `command` and whose name is a shipped sensor (today `crap`, `mutation` and `thresholds`) expands, when the config is read, to `recognizer-sensors <name> --repository {repository} --commit {commit} --output {output} --settings <the mapping as JSON>`. The structure sensor runs the duplication check with every scan, in TypeScript over `web-tree-sitter` and the grammars vendored in `grammars/`; its settings are `sensors.structure.duplication`, `false` to switch it off or a mapping of `threshold` (a number above 0 and at most 1, default 0.82), `min_lines` (an integer of at least 1, default 4), `pair_min_lines` (an integer of at least 1, default 6; a pair needs its shorter member at `max(min_lines, pair_min_lines)` lines) and `min_nodes` (an integer of at least 1, default 20). Only `recognizer scan` parses source: `recognizer check`, the read commands and the app carry the stored duplication findings forward when the commit, the settings and the per-module hashes are unchanged, and say `duplication not measured since the last scan` otherwise. A `sensors.duplication` entry is a config error naming the new keys. An entry with a `command` is used as written, and a mapping with no `command` under any other name is a config error. The program is `recognizer-sensors` on the login `PATH`, installed with the toolchain. `crap` runs the test suites listed under the config's top-level `tests:` key (so it executes the repository's code, in the working tree) and takes `threshold` (a number above 0, default 30) and `overlay` (a relative path inside the repository, default `.recognizer/cache/overlays/crap.json`); `tests:` is a non-empty list of suites, each with `name` (unique), `language` (`python`, `typescript`, `kotlin`, `rust` or `csharp`), `directory` (relative, no `..`), `command`, an optional `activate` and `env`, and `coverage {path, format}` with `format` `lcov` or `jacoco`; a `typescript` suite also names its `runner`, `vitest` or `jest`, and no other language may. The list is handed to the `crap` and `mutation` commands (every shipped sensor that runs tests) in their `--settings` JSON, whether registered in the short form or requested without being registered, and to no other sensor; `mutation` takes `carry` (folders a copy takes that git does not list) besides its other settings, and `test_command` and `coverage` under `sensors.mutation` are config errors; `test_command` and `coverage` under `sensors.crap` are config errors. With no `tests:` list `crap` does not run. Besides its findings file it writes that overlay (complexity, coverage and crap per function, a function with unknown coverage left out of the last two), and a CRAP finding is a warning with the id `crap:<module>::<function>` and the fix pattern `simplify-or-test`. `mutation` takes `carry`, `max_minutes`, `max_workers`, `timeout_factor`, `incremental`, `record`, `survivors` and `overlay` (default `.recognizer/cache/overlays/mutation.json`), measures and judges in one run, and replaces the retired `overlays.mutate` registration. `thresholds` takes a mapping from metric name to `{above: N}` or `{below: N}` with an optional `severity` (`warning` by default, or `violation`), or `off`; its defaults are complexity above 10 and coverage below 0.6, and list it after `crap` in the config to judge that run's overlay. `recognizer check` lists duplication warnings largest first by lines duplicated (the sum of the members' line counts), then by id. A duplication finding, found in the structure findings document, is a warning with the id `duplication:<module>::<function>|<module>::<function>`, the fix pattern `extract-shared-function` and, in `evidence.members`, each function's `file` and `lines`.

`sensors.structure: off` removes it and its file. `structure` takes only settings or `off`; every other name takes only a `command` with the `{repository}`, `{commit}` and `{output}` placeholders. `{output}` is a temporary file, not the findings file: the CLI validates what the command wrote there and moves it to `.recognizer/cache/findings/<name>.json`, so a command writes only to that path and derives nothing from it. `entry_points` has no command-line flag. `warnings.orphan` is a boolean or `{ entry_points: [<glob>, ...] }`, which means on with those entry points; `warnings.unused_exports` is a boolean, off by default, and reads the same `entry_points`; `warnings.private_imports` is a boolean, on by default; `warnings.long_function` is a boolean or `{ limit: N }` (an integer of at least 1, default 20, Clean Code's figure), which means on with that limit, and `sensors.structure.warnings.long_function.limit` sets it. The settings in effect are recorded in the file and printed as `sensor structure: cycle on, orphan on, unused_exports off, private_imports on, long_function on, long_function_limit 20` (with `, entry_points N` appended when `warnings.orphan.entry_points` lists any); `--json` gains a `sensors` list of `{ name, status, reason?, settings? }` with the status `ran`, `off`, `failed`, `stale` or `missing`; a registered sensor is `ran` only when its file is current, `stale` when its file is from another commit and `missing` when it has none.

`recognizer scan --sense all` (or `--sense <name>[,<name>...]`, run in config order) runs the registered sensors after the scan's first phase, and prints `ran <name>` or `failed <name>` per sensor under a `sense` heading. `--sense all` means the registered sensors only, and a registered `crap` or `mutation` runs the repository's tests on it; a shipped sensor named explicitly runs whether or not `config.yaml` has an entry for it (an entry only carries settings). A shipped sensor with `runs_tests` has no time ceiling and every other sensor has sixty seconds. An unknown name is exit 2 before anything runs, naming the registered and the shipped ones. A sensor that fails to start, exits non-zero, writes no file, writes invalid JSON or a document that breaks the schema, names another sensor or carries another commit is reported as `failed <name>: <reason>` on stderr, leaves no file and makes the run exit 1; the remaining sensors still run. [The scan phases](#recognizer-scan) describe the whole command.

`check` in repository mode runs the structure sensor (written through a temp file and a rename) and reads the findings file of the structure sensor (unless off) and of every sensor registered now, and of every shipped sensor, and removes any other with a `removed unregistered <name>` line on stderr; it never runs a registered sensor, so run `recognizer scan --sense all` first when their findings should count. A finding counts only when its file is valid and every module it names is current: the file records the hash of each module it measured (`inputs`) and, for a sensor that runs the repository's tests, the hash of the test files (`tests`), and a module is current when its recorded hash equals the scans' hash for that path and the tests hash equals the current one, whatever commit the file was written at. A file with no `inputs`, or with a `tests` that differs, is reported as `stale <name>` and contributes nothing; a file with some modules out of date contributes the rest, is reported as `out of date <name>: N findings`, and carries `out_of_date: N` in `--json`. Neither changes the exit code, and a baseline entry for a finding that is out of date is held, neither new nor fixed, so `--update-baseline` never removes it. Violations from any sensor go through the baseline by id; warnings never change the exit code. `check --scan` runs the structure sensor in memory and writes nothing.

Migrating: the former shipped sensor `unused-exports` is now the structure warning `unused_exports`, so a short-form entry `unused-exports: {}` (or with `entry_points`) is a config error naming `config/sensors/unused-exports`. Add `unused_exports: true` under `sensors.structure.warnings` and move any `entry_points` it listed under `warnings.orphan.entry_points`; a command-form `unused-exports` entry is unaffected.

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

A scan must carry `schema_version` 7; a version-1 scan is refused with exit `2`. Edges that carry `inferred` are read from the scan and ignored by every output: violations, `unranked`, metrics and warnings are computed from the other edges only. A later item decides whether inferred edges count.

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

A violation from a sensor that is not edge-shaped is held as `{ "id": "<finding id>" }`. The `{from, to, kind}` entries come first in the order above, then the `{id}` entries in id order. A `{from, to, kind}` entry is the finding id `rule-violation:<kind>:<from>-><to>`, so `new`, `fixed` and the baseline flags work over ids and a committed baseline keeps its meaning.

`new` is the violations not in the baseline. `fixed` is the baseline entries that no longer occur; they never fail a run.

## Flags

- `--baseline <path>`: default `baselines/violations.json` beside the policy file.
- `--update-baseline`: rewrites the baseline without the fixed entries. It never adds: with any new violation it writes nothing and exits 1. A missing baseline is exit 2.
- `--init-baseline`: creates the baseline from every current violation. An existing baseline is exit 2.
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
  "warnings": [],
  "metrics": []
}
```

`rules` entries are `{"type": "level", "from_level", "to_level"}`, `{"type": "uses", "from_component", "to_component"}` or `{"type": "forbid", "pattern"}`; the sample shows the first, and a `uses` entry reads `{ "type": "uses", "from_component": "orders", "to_component": "billing" }`. `action` is `none`, `initialised` or `shrunk`. Without `--policy` the first five keys are absent and the document is `warnings`, `metrics`, `folder_metrics`. The human summary on stderr ends with a `warnings: N` line.

## Warnings and metrics

Metrics are computed per module from the scan alone, over distinct modules after `ignore`, with self-edges dropped. Foreign nodes carry no metrics and add to no module's coupling. A ratio with a zero denominator is `null`, never `0`.

- `fan_in`: the number of distinct other modules with an edge to the module.
- `fan_out`: the number of distinct other modules the module has an edge to, foreign targets excluded.
- `afferent`: equal to `fan_in`.
- `efferent`: equal to `fan_out`: foreign targets count for nothing.
- `instability`: `efferent / (afferent + efferent)` rounded to four decimals, `null` when both are 0.
- `abstractness`: 1 when the module's `kind` is `interface`, otherwise 0.

Folder metrics are written beside them as `folder_metrics`, one row per folder (a module id up to its last `/`, or `.`) that holds a kept module, sorted by `id`, always computed whatever the warning switches say; `check <module>` keeps only the folders of the named modules. A subfolder's modules are not part of its parent. The graph is the kept graph of every scan, with self-edges dropped; a foreign target counts for nothing, in either coupling.

- `modules`: the kept modules in the folder.
- `afferent` (Ca): distinct modules outside the folder with an edge to a module inside.
- `efferent` (Ce): distinct modules inside the folder with an edge to a project module outside; an edge to a foreign node adds nothing.
- `instability`: `efferent / (afferent + efferent)` rounded to four decimals, `null` when both are 0, so a folder whose only outside imports are foreign and that nothing imports has an unknown instability.
- `exported_members` and `abstract_members`: the exported members of the folder's modules, and those among them that are abstract members: kind `interface`, kind `class` tagged `abstract`, or kind `type` tagged `abstract`.
- `abstractness`: `abstract_members / exported_members` rounded to four decimals, `null` when no member is exported (a scan that records no members leaves it unknown).
- `distance`: `abs(abstractness + instability - 1)` from the unrounded values, rounded to four decimals, `null` when either is `null`.

A warning is a graph heuristic reported as a candidate with evidence, never a verdict. Warnings are never baselined and never affect the exit code. Each carries `id`, `principle` (the stable id of a published principle, shown by its name in the text output), `citation` (author, work, year and an optional locator, from the registry), `fix_pattern` (`private_imports` and `long_function` carry none), a one-line `summary` and `evidence`, and they are sorted by `id` then by module.

| id | principle | fix pattern |
| --- | --- | --- |
| `cycle` | `levelization` | `break-cycle` |
| `orphan` | `dead-code` | `remove-or-wire-orphan`, or `move-orphan-to-tests` when test files import it |
| `unused_exports` | `information-hiding` | `narrow-exports` |
| `private_imports` | `information-hiding` | none |
| `long_function` | `small-functions` | none |

- `cycle`: a strongly connected component of two or more modules; evidence is its sorted `modules` and the `edges` inside it.
- `orphan`: a module nothing imports that is not an entry point: named literally by a policy entry, a test file by convention (a `test`, `tests` or `__tests__` directory, `test_*.py`, `*_test.py`, `conftest.py`, `*.test.*`, `*.spec.*`, a stem ending `Test` or `Tests`), a module its scanner marks as run rather than imported (Python: a package's `__main__.py`, a module with a top-level `__name__` guard or a package `__init__.py` something loads), or matched by a glob in `warnings.orphan.entry_points`. The structure sensor itself reads no manifest; the scanners read project files (`package.json` workspaces, `.csproj`, `Cargo.toml`, Gradle and Maven files) only to find modules, except that the TypeScript scanner also reads every `package.json`'s `main`, `bin`, `exports` (a `*` pattern of a package that is not private included) and `scripts`, repository HTML `<script src>` tags, `*.config.*` file names and a leading shebang to mark entry points; the Kotlin scanner marks a file with a top-level `fun main`, the Python scanner marks the module each `pyproject.toml` `[project.scripts]` or `[project.gui-scripts]` value names, the C# scanner marks none from a manifest, and the Rust scanner marks Cargo target roots (the library root included) and `cfg(test)` modules, and no file is an entry point by its name alone (`index`, `__init__`, `main`, `mod` and `lib` included), so a repository lists everything else in `warnings.orphan.entry_points`; a Kotlin file with a top-level `actual` declaration carries `actual_of`, the expect files that complete it, and counts as reached whenever one of them is reached (to a fixed point), so a platform file is not an orphan while its expect file is used. The summary of an orphan, plain or test-only, in every language, ends with `; a library can list its public API in warnings.orphan.entry_points`, since library API and build-logic are not inferred. A marked module is skipped by `unused_exports` too. When the scan carries `test_imports` (the Python and TypeScript scanners write them) and test files import the orphan, the summary says it is imported only by N test files, names the first three and counts the rest, says it is not an entry point and suggests moving it next to the tests if it only supports them; the fix pattern is `move-orphan-to-tests` and `evidence.test_importers` lists every test file as `{ file, names }` (`[]` meaning unknown). The text report lists the first 10 test files under the warning; `--json` carries all of them. The set of orphans does not change, and a module no test imports, or one whose scanner records no test imports, keeps the plain wording.
- Policy problems are not warnings and not findings: when a policy with components is loaded, `check --scan`, `check` in repository mode and `scan` print `warning: <policy file>: policy entry <glob> (component <name>) matches no scanned module` for each policy glob no scanned module matches and `warning: <policy file>: folder <folder> holds <n> scanned modules that no component covers` for each scanned folder in which no module matches any component, on stderr, before the sensors run. They are never counted in `warnings: N`, never in the `--json` document and never change the exit code, and nothing persists them; the app shows the same two as messages. The switch for them was removed: a config that sets it is refused, because they are always reported.
- `unused_exports`: off by default, because a library's exports exist for outside callers. One finding per module with a member whose `exported` flag is true that no edge from another module names: a `depends` edge names its `names`, a `depends` edge with none uses every export of its target, `inherits` and `implements` edges use `to_member`, and a dotted member is used through its leading segment; `foreign:` targets and self edges are ignored. Skipped modules are those `orphan` skips (a policy entry named literally, a test file, an `entry_points` match). The summary names the sorted unused names; evidence is `modules` and `members`, each `{module, name}` plus `file` and `lines` for a `module`-kind module (a package member carries `module` and `name` only) and `test_files`, the sorted test files that import that name, when the scan's `test_imports` show one does (exact name, or a dotted member through its leading segment; a test record with no `names` marks nothing). When any listed name carries `test_files` the summary appends `; only tests import <names> (<first three test files> and N more), so if nothing outside the repository uses <them>, delete <them> with <their> tests` and the library hint `; a library can list its public API in warnings.orphan.entry_points`; the listed names and the set of findings do not change. A Kotlin member also counts as used when the same-named member of a kept expect file in its `actual_of` is used: named by an edge from another module, in a file used whole, or called by another member (a call from a member of the expect file itself counts, a recursive call does not); an actual of an actual passes use down, so the chain is followed to a fixed point. A Kotlin expect member counts as used when another member calls it and a kept actual file listing its file has a member of the same name.
- `private_imports`: one finding per Python file that imports a name its owning module marks private: a name with one leading underscore, or a name its module's `__all__` leaves out (the scanner records both as the member's `exported` flag). On by default. Only a Python importer and a Python owner count, because TypeScript, Rust, Kotlin and C# refuse a private import at compile time; test files are skipped; a name with no recorded member, an owner with no members and an import with no names give nothing; policy `ignore` patterns apply. The summary names the importing file, the count of private names, the owning modules and "information hiding (Parnas, 1972)"; evidence is `modules` (the importer), `members` (each private name with its owner, sorted by owner then name) and `edges` (one per owner, with the import lines). It carries no `fix_pattern`.
- `long_function`: one finding per function or method longer than 20 lines (Martin, Clean Code, 2008, chapter 3: functions should be small), counted as `end_line - line + 1`; a length of 20 gives none, 21 gives one. On by default, and no setting changes the 20. The function is a scan member of kind `function`, or each method of a class-like member, qualified `Class.method`; its identity is `<module>::<qualified name>`, with `@<line>` appended when the module holds more than one function of that name. Test files are skipped; a function with no `line`, no `end_line` or an `end_line` before its `line` gives nothing; policy `ignore` patterns apply; an entry-point module is still reported. The summary names the function, the file, its length, the limit and "functions should be small (Martin, Clean Code, 2008)"; evidence is `modules`, one `members` entry with the function's `lines` and `measures` of `lines` and `limit`. It carries no `fix_pattern`.
- `remove-or-wire-orphan`, `move-orphan-to-tests` and `narrow-exports`: the fix patterns for `orphan` and `unused_exports`.
- `break-cycle`: the fix pattern for `cycle`, naming the change that removes at least one edge of the cycle.

The in-effect thresholds are printed as `thresholds` in the output. They are command-line flags only; the policy carries no warnings key.

## Exit codes

- `0`: no new violation, or no policy. Warnings never change the exit code.
- `1`: at least one new violation.
- `2`: bad input - an unreadable or invalid scan, policy or baseline, an unknown or conflicting flag, `--init-baseline` over an existing file, or `--update-baseline` without one.

## recognizer scan

`recognizer scan [REPOSITORY] [--extract] [--describe[=all]] [--sense <all|name[,name...]>] [--modules <file>] [--suites <file>] [--confirm-above <usd>] [--by <name>] [--ignore-retired-config] [--json]` scans a repository in up to three phases, always in this order: extraction, describe, sense. Extraction detects its languages, runs each language's standalone scanner as a separate process, validates the result and writes one scan per language to `<repository>/.recognizer/cache/`. `REPOSITORY` defaults to the current directory. Scans are never merged. A scanned repository should gitignore `.recognizer/cache/`.

Extraction runs only when the scans are not current: there is no valid cached scan for a detected language, the commit differs from a cached scan's, the working tree is dirty (ignoring `.recognizer/`) or a cached scan was taken dirty, or a cached scan's `scanner.version` differs from the trimmed stdout of that scanner's `--version` (a scanner that does not start counts as different). The version probe runs only when the other checks pass. `--extract` extracts regardless. When it is skipped the output says `scans current at <commit>`. After the first phase, extracted or current, `scan` runs the structure sensor and writes `.recognizer/cache/findings/structure.json`, or removes it when `sensors.structure` is `off`; a write failure is `failed structure: <reason>` on stderr and exit 1.

`--describe` describes every module whose line is missing, out of date or unreadable, exactly as `recognizer describe` does with no names, and `--describe=all` describes every module (the value only with `=`; `--describe all` leaves `all` as the repository). `--sense all` runs the registered sensors and `--sense a,b` runs those named, registered or shipped. A phase not asked for appears in no output and no record, except extraction, which always appears. Exit 2 comes before anything runs: more than one repository, an empty `--by`, a missing `--sense` value, an unknown sensor name, `--sense` with no sensors registered, or a repository that is not a directory. Exit 4 is the preflight refusal described below. Exit 1 comes after every entry has run: a language, a describer entry or a sensor entry failed. In CI, run `recognizer scan --sense all` and then `recognizer check`.

`--ignore-retired-config` reads the config as if every retired key had never been written, instead of refusing it, and reads a moved `sensors.duplication` as `sensors.structure.duplication`, so the files of a past commit can be scanned; every other config error still refuses, and the flag takes no `--describe` or `--sense`.

### Preflight

After the scan marker is held and before the describe and sense phases, `scan` runs a preflight over what is ticked, so a scan runs completely or not at all. It emits `{"event":"preflight","state":"run"}`, then checks in two stages. The early stage runs before extraction: the folder has no git commit and a sensor is ticked, no describer is registered and `recognizer-describe-claude` does not start, a reference describer (`recognizer-describe-claude`, or the in-tree `describers/claude/dist/bin.js`) rejects `--model <name> --check`, a describer that is not a reference describer does not start (it is run with `--version` only, because its arguments cannot be probed without a model call), or `recognizer-sensors` does not start while a shipped sensor is ticked. The project stage runs after extraction: each ticked sensor that is a shipped sensor is asked for its readiness, as `recognizer sensors check` asks it (below), with no `--run`. It runs no tests and writes nothing, and a check that does not answer is itself a gap (`check-failed`).

A gap is `{id, line, needs, fix}`: `needs` lists the ticked sensors, and `describe`, that depend on it, and `fix` is `{text, command, cwd, env, kind}` where `kind` is `repository` for a fix that changes only the repository or its managed environment and `outside` for anything else. A sensor's gap has the id `<sensor>:<suite or config>:<code>`, the sensor's sentence as `line`, and an `outside` fix whose text is `recognizer help sensors <sensor>` and whose command is null: a pointer to the sensor's setup guide, never an install command. A gap in a sensor or describer that is not ticked is never reported. Any gap means nothing runs: `scan` emits `{"event":"preflight","state":"gaps","gaps":[...]}`, writes one line per gap to stderr without `--json` (`<line> (<needs>): <fix>`), still emits `summary` with `exit: 4`, and exits `4`; a refusal after the early stage skips extraction, one after the project stage keeps the scans it extracted. A passing preflight emits `{"event":"preflight","state":"ok"}`. A stopped or budget-limited run is never a gap. The summary event and the run record carry `skipped: [{phase, reason}]` for every requested phase not run: the phases a refusal skipped (reason `preflight found N gaps`) and a describe language with no scan (reason `no scan for <language>`).

### Readiness checks

`recognizer sensors check [name] [--run] [--json] [--repository <dir>]` asks each registered sensor that is not off, or the named one (a shipped sensor not registered is checked with the `tests` list a scan would pass it), to check its own readiness. For a shipped sensor it runs `recognizer-sensors <name> --check` and prints the gaps the sensor reports, one sentence each, as given: the core relays them without interpreting them. Exit `0` when every sensor is ready, `1` while any gap remains, `2` for bad input. `--json` prints `{ready, sensors: [{name, ready, gaps: [{code, suite, line}], notes: [{code, suite, line}]}]}`. A note is a remark that is not a gap: under `--run`, a ready suite whose coverage report covers fewer than all scanned files of its language prints `coverage-partial` with the count, as an indented line after the `ready` line or the last gap; it never changes `ready`, the exit code or the scan's preflight, and an answer with no `notes` key is read as none. `--run` also runs each ready suite once and confirms its coverage report appears and parses; nothing else starts a test run. A sensor whose command is not `recognizer-sensors` is listed as having no readiness check and counts as ready. A check that does not start, exits non-zero, times out (600 seconds without `--run`) or prints no readable gaps is one gap, `check-failed`; a missing `recognizer-sensors` is `sensors-missing`. Nothing is installed or fixed: a person or an agent installs what is missing and checks again.

`recognizer help sensors <name>` prints the setup guide the sensor supplies (`recognizer-sensors <name> --guide`), or says the sensor supplies none. The guide of `crap` and `mutation` shows the [`recognizer config`](#recognizer-config) commands that write the config, then `recognizer sensors check --run`.

A sensor that exits 0 with a `tool-missing` or `coverage-unavailable` diagnosis is a failed entry whose reason is the diagnosis line; `tests-failed` stays `ok`.

### Detection

The repository is walked depth-first, skipping directories named `.git`, `node_modules`, `.venv`, `venv`, `dist`, `build`, `.worktrees` and `.recognizer` at any depth; directory symlinks are not followed. A language is detected only where its scanner would look: Python on a `.py` file outside directories its scanner skips (`__pycache__`, `test`, `tests`, `site-packages`, dot directories, `*.egg-info`, virtual environments) and not a `conftest.py` file (a `test_*.py` or `*_test.py` file outside a test directory is source); TypeScript on a file named `tsconfig.json` or a `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts` or `.cts` file outside `test`, `tests`, `__tests__` and dot directories, and not a `.d.ts`, `.d.mts`, `.d.cts`, `*.test.*` or `*.spec.*` file; Kotlin on a `.kt` file outside `build` and dot directories (a Gradle or Maven build file alone detects nothing); Rust on a `.rs` file outside `target`, `node_modules` and dot directories (a `Cargo.toml` alone detects nothing); C# on a `.cs` file outside `bin`, `obj` and dot directories and not a `*.g.cs`, `*.g.i.cs` or `*.Designer.cs` file (detection is by path alone, so a repository whose only C# is test projects is detected and scans to zero modules). A JavaScript-only repository is therefore scanned by the TypeScript scanner. The shared `fixtures/selection-parity.json` tree is checked against detection as well as against the scanners. A repository may be both. With no language detected nothing is run and `no languages detected` goes to stderr. In a git repository, detection and every scanner count only the files `git ls-files --cached --others --exclude-standard` lists, so a git-ignored folder is never extracted; a folder outside git, or where git fails, is walked unfiltered.

### Scanners and overrides

Each detected language runs `<scanner> <repository> --output <temporary file>`, plus `--commit <sha>` when `git -C <repository> rev-parse HEAD` succeeds. The scanner is `recognizer-scan-python`, `recognizer-scan-typescript`, `recognizer-scan-kotlin`, `recognizer-scan-csharp` or `recognizer-scan-rust`, found on `PATH`, unless an environment variable names one absolute executable path instead: `RECOGNIZER_SCAN_PYTHON`, `RECOGNIZER_SCAN_TYPESCRIPT`, `RECOGNIZER_SCAN_KOTLIN`, `RECOGNIZER_SCAN_CSHARP` or `RECOGNIZER_SCAN_RUST`. An empty variable is treated as unset; a relative one fails the language with `invalid-override`. A checkout's scanners need a launcher (`uv run --project scanners/python recognizer-scan-python`, `node scanners/typescript/dist/bin.js`, `uv run --project scanners/kotlin recognizer-scan-kotlin`, `uv run --project scanners/csharp recognizer-scan-csharp`, `cargo run --release --manifest-path scanners/rust/Cargo.toml --`), so point the variable at a small executable script that runs it. No scanner is published yet, so install them from a checkout.

### Scan output

The scan is validated, then its bytes are copied unchanged to `.recognizer/cache/scan.python.json`, `.recognizer/cache/scan.typescript.json` or `.recognizer/cache/scan.csharp.json` (one `scan.<language>.json` per language). A language that is not detected leaves no file, and a stale file for it is removed; a language that fails removes its own old file. Other files in the cache, such as overlays, are untouched. Stdout has a heading line per phase (`extract`, `describe`, `sense`) and then one line per entry, such as `python: 14 modules, 19 edges -> .recognizer/cache/scan.python.json`, `described <module>`, `ran <sensor>` or `failed <sensor>`; the describe phase ends with `described <n>, failed <n>, already current <n>`. Failures and removals go to stderr, prefixed with the language.

`--json` makes stdout one JSON object per line, written as each event happens: `{"event":"phase","phase":"extract","state":"run"|"current","commit","reason"}` (`reason` only for `run`: `forced`, `no-commit`, `no-languages`, `no-scan:<language>`, `commit-changed`, `dirty`, `scanner-version:<language>` or `scanner-unavailable:<language>`), `{"event":"projection","phase":"describe","modules","model","input_tokens","output_tokens","cost_usd"}` (immediately before the describe phase event), `{"event":"confirm","phase":"describe","modules","model","input_tokens","output_tokens","cost_usd"}` (only with `--confirm-above`, after the projection, when the projection is above the value or its price is unknown; the scan then waits for the answer, which `{"event":"answered","phase":"describe","describe"}` records: `describe` continues, anything else skips describing and the phase reports `total` 0; the answer is the Describe answer file the app writes beside the run record, or for a scan started from a terminal also a line typed there, `describe` continuing and anything else or end of input skipping), `{"event":"phase","phase":"describe"|"sense","total"}`, `{"event":"start","phase":"sense","name"}` (immediately before each sensor runs), `{"event":"entry","phase","name","outcome":"ok"|"failed","reason","diagnosis"}` (`reason` and `diagnosis` only when the run entry has them; `diagnosis` is the sensor's Diagnosis object; an extract entry that wrote a scan adds `modules` and `edges`), `{"event":"stopped","phase":"describe","cause":"limit"|"failures","reason","described","not_described","threshold"}` (after the describe phase's last entry, when it stopped on a limit or on a batch of failures in a row; `not_described` is a count and `threshold` the batch of failures in a row) and last `{"event":"summary","repository","commit","modified","exit","phases","removed","log"}`, where `phases` repeats each phase's entries, `removed` lists the absolute paths deleted and `log` is the run record's id (its file name without `.json`, as `recognizer log` prints it) or null when no record was written. The extraction failure reasons are `not-installed`, `invalid-override`, `scanner-failed`, `invalid-scan` and `unknown-schema-version`.

### Scan exit codes

- `0`: every detected language was written, or none was detected.
- `1`: at least one detected language failed; the others still run and are written.
- `2`: bad usage - an unknown flag, more than one `REPOSITORY`, or a `REPOSITORY` that is not a directory.

## recognizer config

`recognizer config` reads and edits `.recognizer/config.yaml` one value at a time at a dotted key, the way `git config` does: `recognizer config sensors.mutation.max_minutes 10`, `recognizer config --add sensors.mutation.carry .venv`. The verbs are `<key> <value>` (set; it creates the file, the folder and every map or list entry on the way), `--add <key> <value>` (append to a multi-valued key; an item already present changes nothing), `--get <key>` (exit 1 when unset), `--list` (every value as `key=value`, in file order), `--unset <key> [<value>]`, `--remove-section <section>` and `--add-section <section>` (`sensors.<name>` writes `<name>: {}`, which registers a sensor with its defaults; an existing section is left alone). An empty registered section lists as `<section>=`, for example `sensors.crap=`. All take `--repository <dir>`, and `--` ends the options so a value may start with a hyphen. A write prints nothing and goes through a temp file and a rename, so a scan never reads half a file. A refusal exits 2, prints `recognizer config: <key>: <reason>` and changes nothing; `--unset` and `--remove-section` exit 1 when there is nothing to remove.

`tests.<name>.*` addresses the `tests:` list entry whose `name` is `<name>`, as git's `remote.origin.url` addresses a remote; setting its first key creates the entry with `name` first. A map such as `env` is one more key level. The edit keeps the file's comments, order and formatting: it uses the `yaml` package's document model with no flow padding, the file's own indent and no line folding, and an empty flow map or list that gains an entry becomes block style. Hand edits stay supported.

The core owns no key beyond its own. Each owner publishes a key schema, a JSON document described by [`schema/config-keys.schema.json`](../schema/config-keys.schema.json) with examples in `schema/config-keys-examples/`: its `keys` (a dotted path with `<placeholder>` segments, a `type` of `string`, `integer`, `number`, `boolean`, `enum` or `path`, optional `values`, `multi` and bounds, a description and an example, and optionally one of `default`, `defaults` (a map from the key's placeholder value to a figure) or `default_text` (what applies when the key is absent, for a default that is a behaviour), which `recognizer config --help` prints and the Settings modal shows beside a changed value) and its `sections`. The core's own table is `check/src/config-keys.ts` (the `describer` key, sensor registration and the structure sensor's settings); `recognizer-sensors --schema` prints the sensors package's (the test suites and each shipped sensor's settings). A typed key is matched against every published key, a literal segment beating a placeholder; two keys that match equally fail the load, naming both owners. `recognizer help config` and `recognizer config --help` list every key from every owner with its type, allowed values, owner, description and an `example:` line.

Each write checks that the key exists, that the value has the key's type, that it is inside the bounds and in the allowed values (`tests.unit.coverage.format foo` is refused naming `lcov, jacoco`), that a scalar is not written over a section or the reverse, and that a plain set does not land on a multi-valued key. It does not check that the whole file is complete or consistent, because a suite is built one key at a time: the config parse reports a suite with no `command`, with exit 2, the next time anything reads the file. When `recognizer-sensors` does not answer, the core's keys still work, a key only it owns is refused as `no such key` with `recognizer-sensors did not answer: <reason>`, the help says the same, and `--list` prints what it can, reports a list of entries it cannot address on stderr and exits 1.

## recognizer policy

`recognizer policy` reads and edits `.recognizer/policy.yaml` one value at a time at a dotted key, with the verbs, argument counts, `--repository` and `--` handling of `recognizer config`: `recognizer policy --add components.domain src/domain/**`, `recognizer policy --unset components.legacy`. The keys, each a list of strings, are `components.<name>` (the globs of one component), `levels` (component names, inner first, in the order added), `uses.<name>` (the components `<name>` may depend on), `forbid` (`<from-glob> -> <to-glob>` strings), `foreign.<name>` (the members of one foreign group) and `ignore` (globs); `components`, `uses` and `foreign` are the sections `--add-section` and `--remove-section` address. A name is one dotted segment, so `--list` reports a hand-written name with a dot or a space on stderr as `cannot be addressed` and exits 1. `recognizer policy --help` lists every key with its type and an example.

Each edit keeps the file's comments, blank lines, order and indent, as `config` does. Before a write is saved the new text is parsed as a policy: a write is refused when it introduces an error the original text did not have, exiting 2 with `recognizer policy: <key>: <reason>` and leaving the file untouched. A policy that is already invalid by hand stays fixable, because only new errors refuse a write. So a component is added before the level or rule that names it, and removed from `levels` and `uses` before it is unset. The last item of a list deletes the key, so an empty `uses.<name>` cannot be written through the command.

With no `.recognizer/policy.yaml`, the first write creates the folder and the file; `--get`, `--list`, `--unset` and `--remove-section` print `recognizer policy: there is no policy at .recognizer/policy.yaml` and exit 1. Exit codes: `0` written, read or unchanged; `1` nothing found, no policy file, or a path `--list` cannot address; `2` bad arguments or a refused write.

## recognizer doctor

`recognizer doctor [REPOSITORY] [--json]` says whether a repository's Recognizer setup is valid and still matches its code, with the command that fixes each problem. It is cheap and read-only: it never extracts, scans, describes or runs tests, and writes nothing. The only processes it starts are `git` and, for each registered shipped sensor, `recognizer-sensors <name> --check` (never `--run`).

It reports four areas in this order, one line per problem with its `fix:` under it:

- `config`: every section of `.recognizer/config.yaml` in one pass, unlike a command that reads only the sections it needs. A retired key (`config-retired`) names `recognizer config --unset <key>`, which also removes a section the key leaves empty, an empty sensor section (`config-empty`) names `recognizer config --remove-section sensors.<name>`; unparseable YAML (`config-yaml`), a duplicate test suite name (`config-duplicate-suite`) and a schema fault (`config-invalid`) give an instruction.
- `policy`: `.recognizer/policy.yaml` parses and is valid (`policy-invalid`). With a valid policy that has components, a language with no cached scan is `scan-missing` and one whose scan is out of date with the working tree is `scan-stale`, both counted; the missing scan is fixed with `recognizer scan`, and so is a stale one unless it is stale because the working tree has changes outside `.recognizer/`, when the line names the first three paths and the fix is text (commit, ignore or stash them, then scan); with current scans, an entry matching no module is `policy-entry` (fixed with `recognizer policy --unset components.<name> <glob>`) and a folder no component covers is `policy-folder` (fix text naming `recognizer policy --add components.<name>` and `--add ignore`). A `policy-invalid` line has a `recognizer policy` command for an unknown level or `uses` name and a text for a structural fault. No policy file gives no line.
- `scanners`: each language present in the repository has its scanner on `PATH` (`scanner-missing`) or a valid `RECOGNIZER_SCAN_<LANGUAGE>` override (`scanner-override`); it is looked up, never run.
- `sensors`: each registered sensor's readiness gaps as `recognizer sensors check` reports them without `--run` (`sensor-gap`). The area is skipped, and not counted, when the config has problems.

A fix command carries `--repository <path>` (a positional path for `recognizer scan`) only when `REPOSITORY` was given, so a line printed in a shell loop over several repositories runs as printed. The text ends with `No problems` or `<n> problems`. `--json` prints `{ repository, ok, problems, areas: [{ name, skipped, problems: [{ code, subject, line, fix: { text, command } }] }] }`, where `fix.command` is `null` when the fix is an instruction. Exit 0 means no problems, 1 at least one, 2 a usage error. There is no multi-repository mode: run `for r in a b; do recognizer doctor "$r"; done`.

## recognizer open

`recognizer open [FOLDER|LINK]` opens a folder, or a `recognizer://` link, in the Recognizer viewer. `FOLDER` defaults to the current directory and is resolved to an absolute path. A link is `recognizer://open?repo=<percent-encoded absolute path>[&view=<name>]`: `repo` must be an existing folder and `view`, when given, a view saved in its `.recognizer/views/`; any other parameter, a duplicate or a malformed value is refused. The link is checked before the bundle is looked for and passed to the viewer unchanged, which opens the folder and the view, or focuses the window already showing the folder. A link only opens: it never scans, describes or writes. The viewer is the `Recognizer.app` bundle: the command uses `$RECOGNIZER_APP` when it is set and non-empty (an absolute path to a `.app` bundle), otherwise `~/Applications/Recognizer.app`, then `/Applications/Recognizer.app`. It starts the bundle's single executable in `Contents/MacOS` detached, with the folder (or the link) as its one argument, and returns without waiting. Starting the executable directly lets a running viewer receive the folder, which `open -a` does not.

- `0`: the viewer was started.
- `1`: the environment is wrong - no bundle was found (the message says to run `npm run install-app` from a checkout), `Contents/MacOS` does not hold exactly one executable, or the launch failed.
- `2`: bad input - more than one `FOLDER`, a `FOLDER` that is not a directory, a link that is malformed, names a missing folder or names a view not saved there, or a `RECOGNIZER_APP` that is not an absolute path to a `.app` bundle.

### Installing the command

`brew install --cask kenmclennan/tap/recognizer` installs the app and, as a dependency, `recognizer` and the Python and TypeScript scanners (`brew install kenmclennan/tap/recognizer` installs the command alone); `recognizer --version` and each scanner's `--version` print the toolchain version. From a checkout, `npm run build -w recognizer`, then `npm install --global ./check` puts a `recognizer` executable on the npm prefix's `bin`.

## The command table

`check/src/commands.ts` exports `COMMANDS`, the one list `recognizer` dispatches from and `check/src/help.ts` renders help from. Each entry holds a command's name, one-line summary, usage, arguments, options, what it prints as text and with `--json`, exit codes and examples. `recognizer --help` prints every command with its one line; `recognizer help <command>` and `<command> --help` print the full entry. The table holds `check`, `scan`, `open`, `uses`, `used-by`, `callers`, `path`, `find`, `show`, `modules`, `views`, `windows`, `window`, `describe`, `measure`, `report`, `agents` and `help`.

## The agent guide

`recognizer help agents` prints the guide an agent follows (`check/src/agent-guide.ts`): a command section generated from the command table, so a new command appears without editing the guide, then the rules (`.recognizer/` is never read, written or listed; `check --scan` is for CI and fixtures only) and the show-me, extend, explain and drive recipes. `recognizer agents install` writes two skills, listed in `check/src/skills.ts`: `~/.claude/skills/recognizer/SKILL.md`, which only points at the guide, and `~/.claude/skills/recognizer-setup/SKILL.md`, the onboarding skill that walks a user through scan, test suites, policy and `recognizer doctor`, proposing each command and running it only after the user says yes. It also adds `Read(**/.recognizer/**)` and `Edit(**/.recognizer/**)` to `permissions.deny` in `~/.claude/settings.json`, keeping every other key and entry (`check/src/agents-command.ts`). It reports each change, prints `no change` on a repeat run, exits 2 and writes nothing when the settings file cannot be merged safely, and `recognizer agents uninstall` reverses it, removing each skill's folder only when empty. `check/test/skill-eval/judge.ts` is the skill eval: a pure judge over a recorded transcript, run by `check/test/skill-eval.test.ts` over the transcripts in `fixtures/skill-eval/transcripts/`. `--json` prints `{ changes }`.

## Question commands

`recognizer uses <module>`, `recognizer used-by <module>`, `recognizer callers <module> <name>` and `recognizer path <from> <to>` answer what the canvas and the Dependencies tab show. Modules are named by repository-relative path, `--repository <dir>` (default `.`) picks the repository, text is the default and `--json` prints JSON. A question's stdout holds only its answer.

- `uses` and `used-by` list the modules grouped by folder, each with the names used, marked `(private)` or `(inferred)`. Exit 0, including for no modules.
- `callers` lists the modules that call a member, with `(through <Abstraction>)` for a call that reaches it by dispatch, and whether the member is built. A module with no call data in the scan is exit 2, never "no callers".
- `path` finds the shortest chain of `uses` edges, visiting neighbours in id order. Exit 0 when a path exists (including from a module to itself), 1 when none does.
- An unknown module, a wrong argument count or a scan that could not be made is exit 2.

## Read commands

`recognizer find <text>`, `recognizer show <module>` and `recognizer modules` read the scan like the question commands do (`--repository`, `--json`, exit 0 for an answer and 2 for bad input). `show <folder>` takes a folder in place of a module and prints its metrics as one line (`I 0.42 · A 0.10 · D 0.48`) and a table of the values; `--json` holds `folder`, `metrics` and `line`.

- `find` matches a case-insensitive substring against module paths and top-level member names, and lists both. No match is exit 0 with empty lists.
- `show` prints what the explorer's Contents tab shows: the members in file order with their visibility, line and plain-text signature, a class's fields and methods, the responsibility line with its status (`current`, `out-of-date`, `missing`, or `unchecked` when a line exists but no describer is registered or the source cannot be read), and the module's findings. Only exported members are listed unless `--private`; the rest are counted as `hiddenPrivate`.
- `modules` lists every module with its `uses`, `usedBy` and finding counts. `--folder`, `--findings`, `--min-uses` and `--min-used-by` filter; `--sort id|uses|used-by|findings` (id ascends, the others descend with ties by id), `--reverse` and `--limit` order the rows; `total` is the count before filters.
- Findings are read from the findings documents (`loadFindings` in `check/src/load-findings.ts`, shaped per module by `findingsByModuleFrom`). The structure document is reused when `.recognizer/cache/findings/structure.json` is valid, has the scans' commit, was written from a clean tree and records the settings the config resolves to; otherwise it is regenerated and written. A registered sensor's file is read, never run; a finding is read only while its module hashes are current, a file with no `inputs` or a different `tests` hash is ignored with a `stale <name>` line on stderr, and a file with some modules out of date is read for the rest with an `out of date <name>: N findings` line, and a file for a sensor no longer registered is ignored with an `ignored unregistered <name>` line (only `check` removes it).

### Freshness

A question uses the cached scans when every detected language has a cache taken at the current commit and the working tree is clean, ignoring everything under `.recognizer/`. Otherwise it runs `recognizer scan --extract` first, with the scan summary on stderr. The rule is the library function `freshScans` in `check/src/freshness.ts`, which is not exported from the index because it spawns `git`. A cache is reused only when it records `modified: false` and every file in its `files` still has the recorded SHA-256, so a cache written from a dirty tree is not reused after the edits are reverted. A version-3 cache fails validation and is rescanned.

## Library

`import { check, analyse, parsePolicy, parseBaseline, serialiseBaseline, validateScan, collectViolations, SCAN_SCHEMA_VERSION, InputError } from "recognizer"`. `check(scan, policy, baseline)` takes a parsed scan, the result of `parsePolicy` and a parsed baseline or `null`, and performs no IO. `structureSensor(scans, policy, settings, { commit, modified })` returns the structure findings document with the metrics and the unranked count, and performs no IO; `findingsByModuleFrom(documents)` returns each module's violations then warnings as `Finding`s, with `violationText` and `ruleText`; `validateFindings` checks a findings document. `collectViolations(scan, policy)` returns `{ violations, unranked }` for a validated scan, and `SCAN_SCHEMA_VERSION` is the schema version the library reads. The scan validator is built on the first call of `validateScan`, so importing the library compiles nothing and loads where code generation from strings is forbidden. The neighbour, grouping, caller and path functions the viewer and the question commands share (`usesOf`, `usedByOf`, `groupByFolder`, `buildCallerIndex`, `shortestPath` and the rest of `neighbours.ts`, `callers.ts` and `paths.ts`) are pure and import nothing from `node:`. `analyse(scan, ignore)` takes a validated scan and returns `{ warnings, metrics }`. Only `nodeIo` in `cli.ts` touches the filesystem, and spawning processes is confined to it too.

## recognizer views

`recognizer views <subcommand>` builds, shows and checks saved views: files at `.recognizer/views/<name>.json` that record a description, the commit they were saved at and steps. A name is letters, digits, `-` and `_`, at most 64. Every subcommand takes `--repository <dir>` and `--json`; the scan is read from cache when fresh and made first otherwise, and a triggered scan's summary goes to stderr.

The file is `{ schema_version, description, commit, change?, notes?, steps }` (versions 1 and 2 carry `note` and `module_notes` instead of `notes`), described by [`schema/view.schema.json`](../schema/view.schema.json) with examples in `schema/view-examples/`. A step is one of `pick` (a module), `rule` (`folder`, or `uses` / `used-by` of a module, optionally `within` a folder), `fold`, `focus` (at most one) or `left-out` (a module a rule put there). No layout or selection is stored.

Version 3 carries `notes`, a list of `{ module, text, by }` with a non-blank `text` and a `by` of at most 64 characters naming who wrote it. A module or a folder carries at most one note (a folder is its path with one trailing slash, `shop/application/`); when a file holds several notes on one path, readers keep the last and report one warning, and the next write repairs the file. Array order is the reading order: a new note goes last, an existing note keeps its place, and no position, id or timestamp is stored; git holds when. Versions 1 and 2 stay valid and readable (version 2 holds a whole-view `note` and a `module_notes` map, which a version 3 file may not carry). Every view reads its notes in the order listed. An `ordered` boolean written by an earlier version 4 is accepted and ignored, and the next write drops it. Every write by the CLI or the app writes version 4, so an older file is migrated the first time it is rewritten: each `module_notes` entry becomes a `notes` entry, ordered by module path, and the whole-view note is dropped. Notes belong to the view: taking a module off keeps its notes, and `check --fix` renames the module on every note of a renamed pick.

Version 4 also allows `change: { base, head }`, two git refs, which makes the view a change view; it is not allowed before version 4 and every existing file stays valid and byte-identical. A ref starts with a letter, digit or `_`, holds none of `..`, a space, `~`, `^`, `:` or `\`, and so can never be read by git as an option or a revision expression (`fixtures/views/refs.json` is the shared accept and reject list, read by this package and by the app's Rust side). `new --change <base>..<head>` and `set --change <base>..<head>` check that both refs name a commit git knows and exit 1 naming the first that does not (`unknown ref: feature/x`), writing nothing; `set --change none` removes the range.

`diff <name>` is read-only: it runs `git diff --no-renames --name-status -z base...head` and maps the changed paths to the modules of the scan (a path is a candidate when its extension is in the scan's selection; a package module matches a path in its directory), marking each module `added`, `modified` or `removed`. A removed module has `box: "base"` when a scan of the base commit is at hand and `box: "none"` otherwise, and `unmatched` counts the selected files that matched no module. `parseNameStatus` and `changeMarks` (`change-marks.ts`) hold that mapping and are exported from the library.

A version 4 view can be a plan: `plan: true` plus `proposed`, an array of `{module, kind, from?}` where `kind` is `new`, `changes`, `moves`, `moves-and-changes` or `removed` and `from` is the old path, required for the two moves kinds and forbidden otherwise. A plan has no `change`, and the two keys are not allowed before version 4. `views new --plan` makes one, `views add <name> <module> --change <kind> [--from <path>]` and `views change <name> <module> (<kind> [--from <path>] | --clear)` set and clear a proposed change, and `views set --plan` and `--no-plan` convert a view (`--no-plan` drops the proposed changes). A `new`, `moves` or `moves-and-changes` module the scan does not hold is a planned module: on the view, takes a note, never stale. `changes` and `removed` still need the module in the scan. `views show` reads every proposed change back, in text and in `--json` (`plan`, `proposed`, `resolved.planned`).

A proposed entry may name a member instead of a module: `member` is `Name` or `Class.method`, its `kind` is `new`, `changes` or `removed`, and it takes no `from`. `views add <name> <module>#<member> --change <kind>` and `views change <name> <module>#<member> (<kind> | --clear)` set one, naming the member as `module#Name` or `module#Class.method`; `changes` and `removed` need the member in the scan, `new` does not, and adding one puts its module on the view. `views remove <name> <module>#<member>` drops one entry and `views remove <name> <module>` drops the module's member entries too. A module marked wholly `new` or `removed` takes no member entries, and notes stay at module level. A member entry whose member is not in the scan is reported by `views show` and `views check` as not drawn, and never makes the view stale.

A view is stale when it is done with, and nothing ever deletes a stale view for you: a change view whose head is an ancestor of its base (`merged`; a head equal to the base is not), whose head git does not know (`head-missing`), or any view with a pick that no longer resolves (`pick-unresolved`). `staleReasons` and `staleReasonText` (`view-staleness.ts`, exported) decide it from facts handed in; with no answer from git a change view gets no git reason, so unknown is never stale. `list` and `check` print each reason as `stale: <reason>`, and `--json` adds a `stale` array to each view; neither changes an exit code, so a merged view does not turn CI red before someone deletes it.

`resolveView(view, scans)` and `validateView(value)` are exported from the library, with `isOrdered`, `serialiseView` and the pure order model of `notes-order.ts` (`appendNote`, `placeNote`, `moveNote`, `reorderNotes`, `numberOf`, `dropIndex`). Resolution gives the modules the steps put on the canvas now, the folded folders, the focus, and `unresolved`: the steps naming a path that no longer exists. A left-out removes a module a rule contributed, never a picked one.

| Subcommand | What it does |
| --- | --- |
| `new <name> --description <text> [--change <base>..<head>] [--from-window <id>]` | create a view saved at HEAD (`commit` is `null` outside git), empty and reading no scan or, with `--from-window`, holding one pick per module, one fold per folded folder and the focus of that app window (which must hold the repository, and show only modules the scan has) |
| `add <name> <module>...` | pick modules; all must exist or none are added; drops a left-out for each |
| `rule <name> (--folder <f> \| --uses <m> \| --used-by <m>) [--within <f>]` | append a rule |
| `fold <name> <folder>`, `focus <name> <folder>` | append a fold; set the one focus |
| `remove <name> <path> [--fold \| --focus \| --rule <relation> [--within <f>]]` | take a module off (its pick is deleted, and a left-out recorded if a rule still puts it there), or delete that step |
| `note <name> <module-or-folder> <text> [--by <name>]` / `note <name> <module-or-folder> --remove [--by <name>]` | set the one note on a module on the view, or on a folder (a path ending in `/` with a module under it on the view), replacing any note already there; or remove it (with `--by`, only when that author wrote it last); `--by` defaults to `agent` and is who last wrote the note |
| `note <name> <module-or-folder> <text> --after <module-or-folder>` / `--first` | place the note right after the note on another path, or first; an existing note moves; without either a new note goes last and an existing note keeps its place; `--after` and `--first` cannot be combined with each other or with `--remove`, and `--after` must name a path that holds a note |
| `reorder <name> <module-or-folder>...` | set the whole reading order; name every noted path exactly once, and a missing, unknown or repeated path is reported together |
| `set <name> [--change <base>..<head>\|none] [--title <text>] [--description <text>]` | set, replace (`<base>..<head>`) or remove (`none`) the git range; set the title (an empty `--title` removes it) and the description (never blank); at least one flag |
| `diff <name>` | for a change view, the modules its range changed, each marked added, modified or removed, with both commits and `unmatched`; exit 1 for a view with no range or a ref git does not know; writes nothing |
| `show <name>` | steps, notes and what they resolve to now (notes numbered `1. <path>: ...` in reading order; a note whose module or folder is not on the view is marked; a file with several notes on one path prints one warning; `--json` lists `notes` with `number` and `warnings`) |
| `change <name> <module> (<kind> [--from <path>] \| --clear)` | set or clear a plan's proposed change for a module on the view or planned; `--clear` is refused on a planned module (use `remove`) |
| `list`, `rm <name>` | list views with their kind (the range for a change view) and stale reasons; delete one |
| `check [<name>] [--fix]` | list steps naming a path that no longer exists and stale reasons; `--fix` rewrites picks whose files git records as renamed since the view's commit |

A step already present is a no-op (`changed: false`). `commit` is written only by `new`. `check` exits 1 when any step is unresolved or a file is invalid after `--fix`; bad input is exit 2 and writes nothing. `--fix` sees only renames git has staged or committed (`git diff -M --relative --name-status --diff-filter=R <commit>`), never a plain `mv`.

## recognizer windows and recognizer window

`windows` lists the windows the running Recognizer app has open (id, folder, open view, selection); `window [<id>]` prints what one shows: modules, folds, focus, selection, trail and inspector tab, the id optional when exactly one window is open. Both talk to the app over `app.sock` in its config folder (`~/Library/Application Support/com.kenmclennan.recognizer/app.sock`, overridable with `RECOGNIZER_APP_SOCKET`), which only the owning user can open. They take `--json` and no `--repository`. Exit 0 when the app answered, 1 when it is not running or refused (the reason is on stderr, and with two windows open and no id it says to pass one), 2 for bad arguments.

`window <id> add|remove|fold|focus|select|trail|open-view|clear <argument>... [--by <name>]` changes what a running window shows. Each verb is validated against the window's scan before anything changes, then applied as one ordinary history step; the answer is `done` with a summary (`added 4 modules`, or `nothing changed`) or `refused` with the reason naming the unknown module, folder, view or window, and the window is left as it was. `--by` (1-32 letters, digits, spaces, `-` and `_`, default `Agent`) is shown in the window's footer (`Claude added 4 modules - Undo`) and labels the agent's Back and Forward entries. `fold --off` unfolds; `trail uses|used-by <module>` follows a direct dependency or dependent from the active trail panel; `clear` takes `modules`, `folds`, `focus`, `selection` or `all`. The id is required with a verb; `--off` applies only to `fold`.

## recognizer describe

`recognizer describe` writes each module's one-line responsibility with the describer a repository registers in `.recognizer/config.yaml`, and commits the lines to `.recognizer/responsibilities.json`. The scan never describes: no command except `describe` runs the describer. The scan is read from cache when fresh and made first otherwise; a triggered scan's summary goes to stderr.

When `config.yaml` registers no describer, `recognizer describe` and `recognizer scan --describe` use the shipped `recognizer-describe-claude`, recording its command and the version printed by `recognizer-describe-claude --prompt-version`; a registered `describer` overrides it entirely. If the shipped command cannot start and none is registered, both exit 2. `recognizer describe --describer [--json]` prints the describer in effect as `{"command","version","source":"config"|"shipped"}` and runs no model call.

`config.yaml` holds the `describer` and `sensors` keys, described by [`schema/config.schema.json`](../schema/config.schema.json) with examples in `schema/config-examples/`:

```yaml
describer:
  command: [node, "{repository}/scripts/describe.mjs", "{request}"]
  version: "2026-10-a"
```

`command` is run directly with no shell. In each item `{repository}` (the absolute repository path), `{module}` (the module id), `{model}` (the describing model, below) and `{request}` (the path of a JSON request file) are replaced. `version` names the prompt; bump it to redo every line. A line records the bare `version`, whatever the model, so changing the model setting never marks a line out of date; a line recorded as `<version>+<model>` by an earlier release stays current for a describer whose command contains `{model}` and is out of date (reason `version`) for one that does not. To redo lines with another model, run `recognizer scan --describe=all` or bump the version. The request is `{ module, kind, files, source, members, uses, used_by }`: the module's members from the scan, what it uses and what uses it (inferred rows flagged), the files the scan recorded for it and its source. `files` is that one file and `source` its text. The describer prints one line on stdout.

`responsibilities.json` is `{ schema_version: 1, modules }`, described by [`schema/responsibilities.schema.json`](../schema/responsibilities.schema.json) with examples in `schema/responsibilities-examples/`. Each module id maps to its `line`, the SHA-256 `source_hash` of the source it was written from, and the `describer` command (placeholders unfilled) and `version`. A line is current while all three match; another module's change does not outdate it. `validateResponsibilities`, `lineStatus` and `parseConfig` (which reads the describer from `config.yaml` text) are exported from the library.

| Form | What it does |
| --- | --- |
| `describe` | describe every module whose line is missing or out of date, up to the batch size at once; entries and `described` lines stream in finish order |
| `describe <module>...` | describe exactly the named modules, whatever their status |
| `describe --all` | describe every module |
| `describe --check [<module>...]` | run no describer and write nothing: print each module's status and line; exit 1 unless every module is current |

Before the first call, `describe` prints `projection: N modules, ~T input tokens, ~$C (<model>, API-equivalent estimate)` as its first line (`projection: 0 modules` when nothing is selected, `$unknown` when the model names no known family), and `describe --json` carries it as `projection` (`modules`, `model`, `input_tokens`, `output_tokens`, `cost_usd`); `scan` prints the same line first under its `describe` heading. The estimate is each request's size at 3 characters per token plus a fixed 900 tokens, and 80 output tokens per module, priced at the plain input and output rates of the `haiku`, `sonnet` or `opus` family the model names. It is an API-equivalent figure, not a share of a subscription limit, and the CLI never prompts or stops on it. The app alone passes `scan --confirm-above <usd>`, the `confirm_above_usd` setting (a number from 0 to 10000, seeded `5`, read as `5` when absent from `describing`): a projection strictly above it, or with an unknown price, asks the app before any call, and a projection at or below it asks nothing. The question and the answer are lines in the run record's progress file, and the app answers by writing `.recognizer/cache/scan-running.answer.json` (`version` 1, the record's `run_id`, `describe`); a scan the app started ignores stdin, and one started from a terminal takes the first of a typed line and that file. Without the flag a scan never asks.

Each success is written at once, so a later failure keeps the lines already paid for. A describer that does not start, exits non-zero, prints nothing or prints more than one line leaves that module's entry as it was and is reported; the run exits 1 and the other modules are still processed. Exit status 75 from a describer means the provider's usage or rate limit was hit and further calls will fail; any other non-zero status is a failure of that module only. Status 75 stops the run at once: no further call starts, the calls running are ended, the lines already written stay, and the result carries `stopped` (`cause` `limit`, the `module` whose call hit it, its `reason`, the number `described` and the sorted `not_described`). A whole batch of failures in a row (`max(batch_size, 2)` failed calls with no line written between) stops the run the same way with `cause` `failures`, which catches a limit the describer did not recognise. The next run selects the modules left undescribed again. `describe --json` carries `stopped` (null when the run completed) and the exit is 1. Entries for modules no longer in the scan are pruned by `describe` and listed under `gone` by `--check`. Bad input (no describer registered, an invalid config or file, an unknown module, `--all` with a module or with `--check`) is exit 2 and runs nothing. One run at a time is assumed: there is no lock.

The model and the batch size are global settings, not a repository's: `describing` in the app's `config.json` (`~/Library/Application Support/com.kenmclennan.recognizer/config.json`, overridable with `RECOGNIZER_APP_CONFIG_DIR`), `{ "describing": { "model": "haiku", "batch_size": 4 } }`. The app writes the seed at startup and the CLI writes it on first need, keeping every other key; the Settings modal edits it. `model` is a name with no whitespace and no leading `-`; `batch_size` is a whole number from 1 to 16; a bad value is exit 2 naming the key. `recognizer-describe-claude --model <name> <request-file>` passes the model to `claude`, requires the flag with a request file and has no default. The describe phase keeps up to `batch_size` describers running at once, and a `SIGTERM` or `SIGINT` to the CLI ends them all.

## recognizer report

`recognizer report --as <name> [<file>] [--repository <dir>] [--json]` files an agent's review as a report. It reads a findings document (`findings_version` and `findings`) from the file, or from stdin when no file is given, fills `sensor` (`name` from `--as`, `version` the document's own or `reported`), `commit` (git HEAD), `modified`, `settings` (`{}`) and `reported_at` (the time, the top-level mark of a report), validates the result against the findings schema and writes `.recognizer/cache/findings/<name>.json`, replacing any earlier file of that name. `principle` stays free text. Nothing is written, with exit 1, for a document that is not JSON or fails the schema; `--as` is refused with exit 2 when it is missing, is not a sensor name, is `structure` or is a registered sensor, and so is a folder with no git commit. `--json` prints `{ path, commit, findings }`. A report writes no run-log record.

`check`, `show`, `find` and the question commands read a report whose commit is the scan's like any findings file and ignore one from another commit, printing `stale <name> (reported at <short commit>)` on stderr; `check --json` lists it under `sensors` as `ran` or `stale` with `reported: true`. A findings file outside the registered names is removed by `check` unless it validates and carries `reported_at`; only the app's Clear or the next report removes a report.

## Overlays

An overlay is the file a sensor writes for the measurements it takes, one per sensor at `.recognizer/cache/overlays/<name>.json`. A config that still carries an `overlays` key is refused with `config/overlays is retired`: a sensor measures for itself, so register it under `sensors`.

The overlay file is `{ overlay_version, commit, modified, producer: { name, version }, metrics, values }` (version 1 or 2; version 2 adds `inputs`, module id to the scan's file hash, and for a sensor that depends on tests `tests`, a sha256 over the test files), described by [`schema/overlay.schema.json`](../schema/overlay.schema.json) with examples in `schema/overlay-examples/`. `metrics` declares each metric's `name`, `type` (`ratio`, `count`, `number` or `boolean`), `granularity` (`module` or `member`) and `bad` (`high` or `low`). `values` maps each metric name to an object keyed by the scan's ids (`<module id>::<member>`, methods as `Class.method`). `validateOverlay` is exported from the library.

## recognizer log

Each run of `scan` and `describe` that executes at least one scanner, sensor or describer leaves one record in `.recognizer/cache/log/`, whether the CLI or the app started it. The directory keeps the newest fifty records; the write that makes the fifty-first removes the oldest. A record is `<YYYYMMDDTHHMMSSmmmZ>-<kind>.json`, described by [`schema/log.schema.json`](../schema/log.schema.json) with examples in `schema/log-examples/`: `log_version` 1, `kind`, `started`, `finished`, `by` (the `--by` name, else `USER`, `LOGNAME` or `unknown`), `arguments`, `outcome`, `exit` and either `entries` (a `describe` run: one per module) or `phases` (a `scan` run: a list of `{ phase, entries }` for `extract`, `describe` and `sense`, a phase that ran with nothing to do holding no entries) where an entry is one language, sensor or module with its `command` (placeholders filled), `status`, `outcome`, `duration_ms`, `reason` when it failed, `diagnosis` (the sensor's Diagnosis object, present when the entry has one) and `stderr` (the last 8192 characters, with `stderr_truncated` when cut). A run that stops on bad input, `describe --check`, a describe with nothing to do and a scan that detects no language write nothing. A `scan` or `describe` run writes its record when it starts, with `outcome` `running`, `finished` null and no entries (no phases for a scan), and rewrites the same file after each entry of every phase and again at the end, so a run killed between children leaves a partial record that `recognizer log` lists and prints as stopped (`stopped: no finish recorded`, with the entries completed before the kill; `--json` carries `outcome` `running` and `finished` null). Records of kind `measure` written by earlier versions, and records written before scan took phases, are still listed and read; the latter keep their flat `entries` (and a `sense` kind) and still read; `recognizer log` prints them without phase headings. A record that cannot be written prints `could not write run log: <message>` to stderr and changes neither the output nor the exit code.

`recognizer log [<id>] [--last] [--kind scan|describe|measure] [--repository <dir>] [--json]` reads them. With no id it lists the runs newest first, one per line (`<id>  <kind>  <started>  <outcome>  <n> ok, <n> failed`); `--last` prints the newest in full (a scan record with a heading line per phase), `<id>` prints one, `--kind` filters, and `--json` prints `{ runs }` for the list and the record with its `id` for one. It never scans and writes no record. It exits 0 whenever the request was answered, whatever the run's own outcome, and 2 for bad input, an unknown id or no run for `--last`. An agent reads a failure with `recognizer log --last` and never opens the files by hand. `scan` and `describe` each take `--by <name>`, recorded as `by`; a blank name is exit 2. The writer and reader are the pure module `check/src/run-log.ts`, which takes `Io` (`Io.now()` is its clock).
