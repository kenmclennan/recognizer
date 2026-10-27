# Recognizer

Scans codebases into a language-neutral structure model and shows it in a native viewer. [README.md](README.md) says what it is for.

## Design

The design of record is [docs/design.md](docs/design.md). It is temporary: it holds the design while it is decided and built, and is deleted once the code and these docs carry it. Build against it; do not restate it here.

- Its **Decided** section is settled. Do not reopen a decision without Ken.
- Its **Open** section is decided with Ken one question at a time, in the order listed, each recorded under Decided before anything is built on it.
- Its **First build items** section is the build order once the open decisions it names are settled.

The words the code, docs and interface use are defined in [docs/glossary.md](docs/glossary.md); add a term there before using it.

This repo is lightcycle project `kenmclennan/recognizer`, shortcode `REC`; work is filed and built through lightcycle.

## Layout

One repository, a directory per part:

- `schema/` - the scan document's JSON Schema and example scans
- `check/` - `recognizer check`: reads a scan and an optional policy, reports violations, baseline growth, graph metrics and warnings; also `recognizer scan`, which detects languages, runs each scanner and writes the cache ([check/README.md](check/README.md))
- `policies/` - starter policies a scanned repository copies into `.recognizer/policy.yaml`
- `scanners/python/`, `scanners/typescript/`, `scanners/kotlin/` - one standalone CLI per language
- `app/` - the Tauri viewer, built from `kenmclennan/tauri-starter` ([app/README.md](app/README.md))
- `fixtures/` - small sample codebases per language, each with its expected scan

`schema/`, `check/`, `policies/`, `scanners/python/`, `scanners/typescript/`, `app/` and `fixtures/` exist; `scanners/kotlin/` does not yet.

`app/` is the npm workspace `@recognizer/app`: Vite, TypeScript and plain DOM in `app/src/`, and the Rust crate `recognizer_app` in `app/src-tauri/`. It imports `check` as a library (`recognizer`, built to `check/dist` by the `pre*` scripts). Its rules:

- Logic goes in pure modules with unit tests (`scan-loading`, `tree-model`, `tree-filter`, `health`, `open-modules`, `canvas-state`, `canvas-graph`, `canvas-layout`, `canvas-scene`, `canvas-keys`, `edge-evidence`, `member-callers`, `inspector-model`, `picker-model`, `viewport`, `wheel-device`, `layout-source`); views and sources (`*-view.ts`, `*-source.ts`) stay thin, the ELK layout runs in the `layout.worker.ts` web worker, and `main.ts` is the composition root. Rust stays the narrow boundary for the dialog, running `recognizer scan`, reading the cache and launch arguments.
- A command never takes a path from the frontend: Rust reads the folder from the window's assignment. Every window is built by `open_window` and labelled `w-<n>`, and `app/src-tauri/capabilities/default.json` grants the `app-access` permission set to `w-*`.
- Filesystem access goes through `fs_safe`. The `fs_safe` tests are required: they guard the path-confinement boundary, so they are never removed or weakened.
- `plugins.updater.pubkey` holds the real updater public key; the matching private key and the releases repo exist. Release assets are named by slug (`recognizer.app.tar.gz`), and the `RELEASES_TOKEN` secret name is fixed across apps.
- `npm run check:app` is the app's gate (typecheck, tests, lint, format check, `cargo test`, `cargo fmt --check`, `cargo clippy -D warnings`, build); `npm run install-app` builds the bundle into `~/Applications`.

## Rules

- **The scan document is the contract.** Every scanner emits exactly the schema; nothing language-specific leaks into the document, the policy or the viewer. Every scanner is tested against the shared fixtures.
- **Recognizer knows no architecture.** Every architectural meaning - component names, which dependencies are permitted, any preset - lives in a repository's policy. A named architecture is a template under `policies/`, copied into a repository and edited there. Hexagonal vocabulary appears only in fixtures, examples and templates. Warnings are principle violations, reported by `recognizer check` as candidates with evidence, never verdicts; each names its principle, its evidence and a stable fix-pattern id, and the coaching text an agent reads lives outside recognizer.
- **Recognizer never measures.** Metrics that need something run (tests, mutation, duplication, git history) arrive as overlays from converters outside recognizer; recognizer owns the overlay format only.
- **Derived, never authored.** Nothing on the real diagram is drawn by hand. A proposed structure is a separate artifact, always labelled as not in the code.
- **No allow list.** The policy cannot mark a violating edge as acceptable. Existing violations live in a baseline that may only shrink.
- **Missing data is unknown, never healthy.**
- **Prior art is for approach only.** Robert C. Martin's [uml-viewer](https://github.com/unclebob/uml-viewer) states no licence: copy or port none of its code. Its published rules (what counts as an edge, what to skip, how interfaces are marked) may be followed.
- **Scanned repositories own their `.recognizer/` folder.** Policy, proposals and baselines are committed there; scans and overlays go in `.recognizer/cache/`, which is gitignored.

## Worktrees

A fresh worktree has no `node_modules`. Run `npm ci` at the repository root before typecheck, tests or any `npm run` script; the root install covers every workspace.

## CI

Every workflow runs on a self-hosted runner on Ken's Mac (`runs-on: [self-hosted, macOS, ARM64]`), registered to this repo only, because GitHub-hosted minutes for private repos ran out. It has the local toolchain, so no workflow installs system libraries. No workflow uses `Swatinem/rust-cache`: on a self-hosted runner its cleanup prunes `~/.cargo/bin` and deletes `rustup`, which takes `cargo` and `rustc` with it.

## Code style

- No code comments and no docstrings; behaviour is legible from names and tests.
- Blank lines group related statements; whitespace around multi-line statements.
- Markdown: hyphens not emdashes, one line per paragraph, formatted with `prettier --prose-wrap=never` and linted with markdownlint (line length is off, `.markdownlint.json`).
- Keep this file current as the code changes, in the same change.
