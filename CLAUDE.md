# Recognizer

Scans codebases into a language-neutral structure model and shows it in a native viewer. [README.md](README.md) says what it is for.

## Design

The design of record is [docs/design.md](docs/design.md). It is temporary: it holds the design while it is decided and built, and is deleted once the code and these docs carry it. Build against it; do not restate it here.

- Its **Decided** section is settled. Do not reopen a decision without Ken.
- Its **Open** section is decided with Ken one question at a time, in the order listed, each recorded under Decided before anything is built on it.
- Its **First build items** section is the build order once the open decisions it names are settled.

Goal **G-12** in lightcycle (`lc goal show G-12`) tracks this work and logs each decision with its date. This repo is lightcycle project `kenmclennan/recognizer`, shortcode `REC`; work is filed and built through lightcycle.

## Layout

One repository, a directory per part:

- `schema/` - the scan document's JSON Schema and example scans
- `check/` - `recognizer check`: reads a scan and a policy, reports violations and baseline growth
- `scanners/python/`, `scanners/typescript/`, `scanners/kotlin/` - one standalone CLI per language
- `app/` - the Tauri viewer
- `fixtures/` - small sample codebases per language, each with its expected scan

`schema/`, `scanners/python/` and `fixtures/` exist; `check/`, `scanners/typescript/`, `scanners/kotlin/` and `app/` do not yet.

## Rules

- **The scan document is the contract.** Every scanner emits exactly the schema; nothing language-specific leaks into the document, the policy or the viewer. Every scanner is tested against the shared fixtures.
- **Derived, never authored.** Nothing on the real diagram is drawn by hand. A proposed structure is a separate artifact, always labelled as not in the code.
- **No allow list.** The policy cannot mark a violating edge as acceptable. Existing violations live in a baseline that may only shrink.
- **Missing data is unknown, never healthy.**
- **Prior art is for approach only.** Robert C. Martin's [uml-viewer](https://github.com/unclebob/uml-viewer) states no licence: copy or port none of its code. Its published rules (what counts as an edge, what to skip, how interfaces are marked) may be followed.
- **Scanned repositories own their `.recognizer/` folder.** Policy, proposals and baselines are committed there; scans and overlays go in `.recognizer/cache/`, which is gitignored.

## Code style

- No code comments and no docstrings; behaviour is legible from names and tests.
- Blank lines group related statements; whitespace around multi-line statements.
- Markdown: hyphens not emdashes, one line per paragraph, formatted with `prettier --prose-wrap=never` and linted with markdownlint (line length is off, `.markdownlint.json`).
- Keep this file current as the code changes, in the same change.
