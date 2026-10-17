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

### Prior art

Robert C. Martin's uml-viewer is a reference for approach only. It states no licence, so none of its code is copied or ported; its published rules (what counts as an edge, what to skip, how interfaces are marked) may be followed.

## Open

Decide these with Ken one at a time, in this order, recording each under Decided before building on it.

1. **The scan document schema.** How module ids are formed (path-based and stable across languages), what a module carries (file, language, kind, exported members with their kind and line), edge kinds (depends, implements, inherits), foreign libraries, and a `schema_version` so consumers can refuse a document they do not understand.
2. **Toolchains and CI.** Python packaging and minimum version, Node version and package manager, the Tauri and Rust setup, and one CI job per directory triggered by its path.
3. **Where policy checking lives.** A language-neutral `recognizer check` that reads a scan and a policy and reports violations and baseline growth. It needs one implementation language; it is also what lightcycle's audit and CI ratchets call.
4. **The overlay format.** Health data (complexity, coverage, mutation) keyed by module id and commit; missing data shows as unknown, never as healthy.
5. **The Kotlin spike.** Prove tree-sitter-kotlin gives package-level edges good enough to use, before building the scanner.
6. **Proposals in the viewer.** How a proposed structure is drawn beside the real one, always labelled as not in the code.

## First build items

Once 1 to 3 are decided, in this order, each with fixtures and tests:

1. The schema, example scans, and the Python scanner, run against lightcycle (`kenmclennan/lightcycle`, a hexagonal Python codebase).
2. `recognizer check` against a policy for lightcycle, reporting its wrong-way edges.
3. The TypeScript scanner, run against Saga and the knowledgebase explorer, both npm workspaces with path aliases.
4. The viewer: open a repository, scan it, draw the module boxes and edges, colour violations.
5. The Kotlin spike, then the Kotlin scanner.
