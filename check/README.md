# recognizer check

Reads a scan and a policy, reports the dependency violations, and compares them with a committed baseline that may only shrink.

```sh
recognizer check --scan <scan.json> --policy <policy.yaml>
```

## Policy

YAML with the keys `levels` (required), `modules`, `forbid`, `foreign` and `ignore`; any other key is an error.

- `levels` lists level names, inner first. A module may depend on its own level or any inner one; an edge from an inner level to an outer one is a violation. `depends`, `inherits` and `implements` edges are all subject to the rule.
- `modules` maps a level name to one glob or a list of globs. A module matching globs of two levels is an error. A module matching none is unranked: never compared, and reported as a count of distinct ids.
- `forbid` is a list of `<from-glob> -> <to-glob>` strings over full module ids, such as `lightcycle/adapters/* -> lightcycle/adapters/*`. The target may be a `foreign:` id.
- `foreign` groups external libraries. It is validated and otherwise left to the viewer.
- `ignore` is a list of globs; matching modules, and every edge touching them, are dropped before checking.

Foreign nodes are never violations unless a `forbid` names them. A self-edge is never a violation. Edge endpoints missing from the scan's `modules` are still checked.

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
  "baseline": { "path": "", "present": true, "action": "none" }
}
```

`rules` entries are `{"type": "level", "from_level", "to_level"}` or `{"type": "forbid", "pattern"}`. `action` is `none`, `initialised` or `shrunk`.

## Exit codes

- `0`: no new violation.
- `1`: at least one new violation.
- `2`: bad input - an unreadable or invalid scan, policy or baseline, an unknown or conflicting flag, `--init-baseline` over an existing file, or `--update-baseline` without one.

## Library

`import { check, parsePolicy, parseBaseline, serialiseBaseline, validateScan, InputError } from "recognizer"`. `check(scan, policy, baseline)` takes a parsed scan, the result of `parsePolicy` and a parsed baseline or `null`, and performs no IO. Only `cli.ts` touches the filesystem.
