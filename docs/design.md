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
  - adapters/* -> adapters/*
  - "* -> lightcycle/adapters/tui/**"

foreign: # group external libraries
  stdlib: [os, subprocess, sqlite3]

ignore: [tests/**, "**/fixtures/**"]
```

- **The dependency rule comes from `levels`.** An edge from an inner level to an outer one is a violation: drawn red, and counted by the ratchet.
- **`forbid` covers what level order cannot**, such as adapters calling each other.
- **There is no allow list.** A way to mark an edge as acceptable becomes a place for violations to hide. An existing violation goes in the ratchet baseline (`.recognizer/baselines/`), where it is counted and may only shrink, never into the policy.

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

### Prior art

Robert C. Martin's uml-viewer is a reference for approach only. It states no licence, so none of its code is copied or ported; its published rules (what counts as an edge, what to skip, how interfaces are marked) may be followed.

## Open

Decide these with Ken one at a time, in this order, recording each under Decided before building on it.

1. **Toolchains and CI.** Python packaging and minimum version, Node version and package manager, the Tauri and Rust setup, and one CI job per directory triggered by its path.
2. **Where policy checking lives.** A language-neutral `recognizer check` that reads a scan and a policy and reports violations and baseline growth. It needs one implementation language; it is also what lightcycle's audit and CI ratchets call.
3. **The overlay format.** Health data (complexity, coverage, mutation) keyed by module id and commit; missing data shows as unknown, never as healthy.
4. **The Kotlin spike.** Prove tree-sitter-kotlin gives package-level edges good enough to use, before building the scanner.
5. **Proposals in the viewer.** How a proposed structure is drawn beside the real one, always labelled as not in the code.

## First build items

Once 1 and 2 are decided, in this order, each with fixtures and tests:

1. The schema, example scans, and the Python scanner, run against lightcycle (`kenmclennan/lightcycle`, a hexagonal Python codebase).
2. `recognizer check` against a policy for lightcycle, reporting its wrong-way edges.
3. The TypeScript scanner, run against Saga and the knowledgebase explorer, both npm workspaces with path aliases.
4. The viewer: open a repository, scan it, draw the module boxes and edges, colour violations.
5. The Kotlin spike, then the Kotlin scanner.
