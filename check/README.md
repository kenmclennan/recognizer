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

A scan must carry `schema_version` 2; a version-1 scan is refused with exit `2`. Edges that carry `inferred` are read from the scan and ignored by every output: violations, `unranked`, metrics and warnings are computed from the other edges only. A later item decides whether inferred edges count.

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

## Library

`import { check, analyse, parsePolicy, parseBaseline, serialiseBaseline, validateScan, InputError } from "recognizer"`. `check(scan, policy, baseline)` takes a parsed scan, the result of `parsePolicy` and a parsed baseline or `null`, and performs no IO. `analyse(scan, { hub }, ignore)` takes a validated scan and returns `{ thresholds, warnings, metrics }`. Only `cli.ts` touches the filesystem.
