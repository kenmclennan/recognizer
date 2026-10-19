# Recognizer design

Temporary: this document holds the design while it is being decided and built, and is deleted once the code and its own docs carry it.

## What it is

Recognizer scans a codebase into a language-neutral model of its modules and dependencies, and shows that model in a native viewer. The picture is derived from the code and never drawn by hand. The same scan is a machine-readable model other tools read without the viewer, such as lightcycle's codebase audit, which measures change with it and builds ratchets from it.

## Decided

### Granularity

- A box per module. Opening a module shows its classes and functions.
- Kotlin uses a box per package, because code in the same package needs no import; Gradle modules are the top level.

### Languages

- Python, TypeScript and Kotlin.
- One TypeScript scanner covers Node back ends and React front ends. Framework meaning (component, hook, route) belongs in the policy and overlays, not the scanner.

### Scanners

- Each language has a standalone command-line scanner that emits the same JSON scan document, so audits and CI can scan without the viewer.
- Python uses its own `ast` module. TypeScript uses the TypeScript compiler API, so module resolution (tsconfig paths, workspace packages) is right. Kotlin uses tree-sitter-kotlin, proved by a spike first.

### Viewer

A native app: Tauri 2, with the domain, application and drawing code in TypeScript in the webview, and Rust as a narrow boundary for files, running scanners, watching for changes and dialogs.

### Repository layout

One repository with a directory per part, so every scanner is tested against the same schema and fixtures in one CI run:

```text
schema/               the scan document's JSON Schema and example scans
check/                CLI and library: recognizer check
scanners/python/      CLI: recognizer-scan-python
scanners/typescript/  CLI: recognizer-scan-typescript
scanners/kotlin/      after the tree-sitter spike
app/                  the Tauri viewer
fixtures/             small sample codebases per language, each with its expected scan
```

CI runs a job per directory, triggered by changes to its path.

### Files in a scanned repository

Everything the repository's owners write is committed under `.recognizer/`; anything derived is cached and gitignored.

| What | Where | Committed |
| --- | --- | --- |
| Policy: levels, components, foreign libraries, ignores | `.recognizer/policy.*` | yes |
| Proposed structures | `.recognizer/proposals/` | yes |
| Ratchet baselines | `.recognizer/baselines/` | yes |
| Scan results | `.recognizer/cache/` | no |
| Health overlays (complexity, coverage, mutation) | `.recognizer/cache/` | no, unless a project opts in to committing a mutation snapshot keyed by commit |

Scans are not stored for change detection: comparing two commits means scanning both.

### Policy

The one file a repository's owners write, at `.recognizer/policy.yaml`. YAML, because people write it and comments matter. Levels are assigned by path, so the same policy shape works in every language.

```yaml
levels: # inner first; a module may depend on its own level or any inner one
  - domain
  - ports
  - application
  - adapters
  - entry

modules: # which paths belong to which level
  domain: lightcycle/domain/**
  ports: lightcycle/ports/**
  application: lightcycle/application/**
  adapters: lightcycle/adapters/**
  entry: [lightcycle/container.py, lightcycle/cli.py]

forbid: # rules the level order cannot express
  - lightcycle/adapters/* -> lightcycle/adapters/*
  - "* -> lightcycle/adapters/tui/**"

foreign: # group external libraries
  stdlib: [os, subprocess, sqlite3]

ignore: [tests/**, "**/fixtures/**"]
```

- **The dependency rule comes from `levels`.** An edge from an inner level to an outer one is a violation: drawn red, and counted by the ratchet.
- **`forbid` covers what level order cannot**, such as adapters calling each other.
- **There is no allow list.** A way to mark an edge as acceptable becomes a place for violations to hide. An existing violation goes in the ratchet baseline (`.recognizer/baselines/`), where it is counted and may only shrink, never into the policy.
- **The level order is one rule form, not the only one.** The general form is named components with the dependencies each may have (Principles: every dependence is justified by purpose); a level order is the special case where each component may use itself and any inner one. `levels` becomes optional and the components form is added by the policy-shape follow-up, which updates this section.

### Scan document

Each scanner emits one JSON document per language, with `schema_version` (an integer, bumped only on a breaking change; a consumer refuses a version it does not know), the scanner's name and version, the commit scanned, and three lists:

- **`modules`**: one per box. `id` is the repository-relative path with forward slashes and no leading `./`; for Kotlin, the package's directory path. `language` sits on the module, not the document. `kind` is `module`, `package` or `interface` (a module whose exports are only abstractions). `members` lists the classes and functions it contains: `name`, `kind` (`class`, `function`, `interface`, `type`, `constant`), `line`, `exported`.
- **`edges`**: module to module, `from` and `to` by module id, `kind` is `depends`, `inherits` or `implements`, and `line` is where in `from` it comes from, so a violation is clickable. `inherits` and `implements` also carry the two member names (`member`, `to_member`) for the viewer's drill-down. No member-to-member edges; adding them later is an additive change.
- **`foreign`**: external libraries, each a node with id `foreign:<name>`, which edges point at; `name` is what the policy's `foreign` groups match on.

The document is facts about the code only: no policy, layout, colours or violation flags. `check` computes violations from the scan and the policy. A repository with more than one language gets one scan per language; merging them is the consumer's job.

```json
{
  "schema_version": 1,
  "scanner": { "name": "recognizer-scan-python", "version": "0.1.0" },
  "commit": "a1b2c3d",
  "modules": [
    {
      "id": "lightcycle/domain/item.py",
      "language": "python",
      "kind": "module",
      "members": [
        { "name": "Item", "kind": "class", "line": 12, "exported": true },
        { "name": "new_item", "kind": "function", "line": 40, "exported": true }
      ]
    }
  ],
  "edges": [
    {
      "from": "lightcycle/application/claim.py",
      "to": "lightcycle/domain/item.py",
      "kind": "depends",
      "line": 3
    },
    {
      "from": "lightcycle/adapters/sqlite_store.py",
      "to": "lightcycle/ports/store.py",
      "kind": "implements",
      "member": "SqliteStore",
      "to_member": "Store",
      "line": 9
    },
    {
      "from": "lightcycle/adapters/sqlite_store.py",
      "to": "foreign:sqlite3",
      "kind": "depends",
      "line": 1
    }
  ],
  "foreign": [{ "id": "foreign:sqlite3", "name": "sqlite3" }]
}
```

### Toolchains and CI

Each part carries only its own toolchain; no part needs more than one language.

- `scanners/python/`: its own `pyproject.toml`, hatchling build, `requires-python >= 3.11`, uv for the dev venv and lockfile, ruff and pytest. Installable with `uvx` or `pipx`, so an audit needs no checkout.
- `scanners/typescript/` and `app/`: npm workspaces at the repository root, Node 22 in CI with `engines >= 22`, TypeScript 5.9, vitest, biome for lint and format. Prettier (`--prose-wrap=never`) and markdownlint-cli2 at the root for markdown only.
- `app/`: `app/src-tauri` with Tauri 2, Rust stable, edition 2021, `@tauri-apps/cli` in the workspace. CI installs the webkit2gtk system libraries and caches the Rust build.
- `schema/`: JSON Schema 2020-12. No separate validator job: each scanner's tests validate its fixture output against the schema (`jsonschema` in Python, `ajv` in TypeScript), so a schema edit is checked by every scanner.
- Kotlin's toolchain is decided by the spike.

CI is one workflow file per directory, filtered on that directory's path plus `schema/**` and `fixtures/**`: a schema or fixture change runs every scanner, a scanner change runs only itself.

### Where policy checking lives

`recognizer check` is TypeScript in the npm workspace, at `check/`. It reads a scan (JSON) and a policy (YAML) and reports violations and baseline growth. It ships two ways: as a CLI (`npx recognizer check`) for any repository's CI and for audit workers, and as a library the viewer imports, so the picture is coloured by the exact code CI runs. It emits JSON (each violating edge, the baseline delta) and a human summary, and exits non-zero on growth. The baseline file format under `.recognizer/baselines/` is defined with it.

### Principles

Hexagonal, clean and onion architecture are each one arrangement of the same few principles, drawn from Martin, Fowler, Evans, Parnas and Jackson. Recognizer works from the principles, never from a named architecture: a structural smell is a principle violation, reported as a candidate with its evidence attached, never as a verdict. The scan supplies the facts; the policy declares the intent the facts cannot carry.

| Principle | Smell | Needs from the policy |
| --- | --- | --- |
| Dependencies point toward stability | an edge from a more stable component to a less stable one; a component whose measured instability disagrees with its declared place | which components are meant to be stable |
| Depend on abstractions across a boundary | a concrete cross-boundary edge; a stable component that is mostly concrete | component boundaries |
| Policy code is isolated from mechanism | IO, environment, time or framework reached from policy code | which components hold policy, which foreign groups are mechanism |
| No cycles | a dependency cycle | nothing |
| Things that change together live together | co-change across a component boundary (from the git overlay) | component boundaries |
| Every dependence is justified by purpose | an edge no declared relationship requires | permitted dependencies between components |
| Each rule has one home | structural duplication (from the duplication overlay) | nothing |
| Interfaces are narrow and explicit | a hub with high fan-in and fan-out; a wide exported surface | nothing; candidates only |

Metrics derived from the scan graph alone (fan-in, fan-out, cycles, instability, abstractness, distance from the main sequence) are structural facts and are computed by recognizer. Anything measured by running something (tests, mutation, duplication, git history) arrives as an overlay.

A named architecture is a policy template: a starter `.recognizer/policy.yaml` under `policies/` in this repository, copied into a scanned repository and edited there. Recognizer has no setting that names an architecture and never reads anything but the policy in front of it.

### Smells

Recognizer's outputs are sensors, in three layers. Rules are the policy's verdicts: `recognizer check` reports them, the baseline ratchets them, CI fails on growth. Graph metrics are structural facts computed from the scan alone: fan-in, fan-out, strongly connected components, instability, abstractness, distance from the main sequence. Smells are heuristics over the graph and the policy: a threshold or pattern tied to one principle in the table above, reported as a candidate with its evidence, never failing CI. A smell confirmed often enough is promoted to a rule in the policy; a rule baselined and never shrinking is a question about the policy.

Every smell carries what a coach needs and never the number alone: the principle it suspects, the evidence (the modules, edges and members that triggered it) and a stable fix-pattern identifier. A bare metric invites gaming the number rather than fixing the design; habit-hooks' pre-registered evaluation measured a genuine fix in under six percent of trials from a bare complexity message and over eighty percent from a coaching message naming the cue and the action. The coaching text itself lives outside recognizer: a habit-hooks plugin wrapping `recognizer check` and the smell output, or a guidance entry keyed on the fix-pattern id, is a consumer of the format in the same loose relationship as an overlay converter. The plugin is a spike once smells exist.

The baseline is keyed by violation identity across the whole repository. A later item adds a change scope to `check` and to smells, reporting only what the modules touched on a branch introduce, which is what an agent loop acts on.

### Overlays

Recognizer never measures. It owns the overlay format only; converters from a tool's native report (coverage, complexity, mutation, duplication, git churn and co-change) are plugins or separate tools with no dependency on recognizer beyond the format. The format is metric-agnostic: a metric declares its name, value type, granularity (module or member) and which direction is bad, and recognizer stores and paints it without knowing what it means. Well-known metric names have documented shapes but are not the only ones allowed. An overlay names the commit it measured; one whose commit differs from the scan's is drawn as missing. Missing data is unknown, never healthy.

### Prior art

Robert C. Martin's uml-viewer is a reference for approach only. It states no licence, so none of its code is copied or ported; its published rules (what counts as an edge, what to skip, how interfaces are marked) may be followed.

## Open

Decide these with Ken one at a time, in this order, recording each under Decided before building on it.

1. **The overlay document.** The exact JSON shape for the metric-agnostic overlay decided under Overlays: how a metric declares itself, how values are keyed by module and member, and how a converter is discovered.
2. **The Kotlin spike.** Prove tree-sitter-kotlin gives package-level edges good enough to use, before building the scanner.
3. **Proposals in the viewer.** How a proposed structure is drawn beside the real one, always labelled as not in the code.

## First build items

In this order, each with fixtures and tests:

1. The schema, example scans, and the Python scanner, run against lightcycle (`kenmclennan/lightcycle`, a hexagonal Python codebase).
2. `recognizer check` against a policy for lightcycle, reporting its wrong-way edges.
3. The TypeScript scanner, run against Saga and the knowledgebase explorer, both npm workspaces with path aliases.
4. The viewer: open a repository, scan it, draw the module boxes and edges, colour violations.
5. The Kotlin spike, then the Kotlin scanner.
