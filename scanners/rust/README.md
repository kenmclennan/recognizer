# recognizer-scan-rust

Scans a Rust source tree into a scan document, using the `syn` parser.

```sh
recognizer-scan-rust ROOT [--commit SHA] [--modified true|false] [--output FILE]
```

`ROOT` is the repository root and the base of every module id. The commit defaults to `git rev-parse HEAD`, or `null` outside git. Output goes to stdout unless `--output` is given. When a `mod name;` declaration has no file, one line `recognizer-scan-rust: N mod declarations had no file` goes to stderr.

## Files and modules

The scanner reads `.rs` files outside directories named `target` or `node_modules` and dot directories. Test code (`tests/`, `benches/`, `examples/`) and `build.rs` are scanned. Symlinked directories are not followed. A module is one source file and its id is the file's repository-relative path. A file `syn` rejects fails the scan.

## Crates

A crate is a Cargo package's library or binary target. Every `Cargo.toml` with a `[package]` table defines one: its roots are `src/lib.rs` or `[lib] path`, `src/main.rs`, `src/bin/*.rs`, `src/bin/*/main.rs`, `[[bin]] path`, `build.rs` and each file directly in `tests/`, `examples/` and `benches/`. A path dependency (or a `workspace = true` dependency whose workspace entry has a `path`) to a package in the repository is in-repo and resolves to that package's library root; every other dependency, `std`, `core` and `alloc` are foreign. A package can use its own library by name from its binaries and tests.

## Edges

- **Module tree.** From each crate root, every `mod name;` names a child file: `<dir>/name.rs` then `<dir>/name/mod.rs`, under the directory of a root or `mod.rs` file, or under `<dir>/<stem>/` for any other file. `#[path]` is honoured. A `mod name;` makes a `depends` edge; an inline `mod name { }` makes none.
- **Use paths.** Each leaf of a `use` tree is resolved from `crate`, `self`, `super`, `::dep`, an in-repo dependency, or a child module of the current module. A module leaf makes an edge with no `names`; an item leaf makes one whose `names` holds the item. A glob makes an edge with no `names`.
- **Re-exports.** A path that arrives at a file where the next name is brought in by a `pub use` is followed to the defining module, and each file passed through is recorded in `via`, in order. A cycle, or a chain deeper than 16, stops at the last file reached.
- **Foreign.** A first segment naming `std`, `core`, `alloc` or a foreign dependency makes an edge to `foreign:<name>`. A first segment that resolves to nothing makes no edge.
- **Traits.** `impl Trait for Type` makes an `implements` edge when the trait is defined in a scanned file other than this one. Supertraits are `bases`. `inherits` is never emitted.

## Members

Structs and enums are `class`, traits `interface`, functions `function`, `const` and `static` `constant`. `exported` is true for any `pub` form except `pub(self)`. Methods from the `impl` blocks of the same file are in the outline of their struct or enum.

## Limits

Calls, `cfg` and feature evaluation, macro expansion and macro bodies, `use` items inside function bodies, type aliases, enum variants and path expressions that are not `use` items are not read. An `impl` for a type declared in another file adds nothing to any outline. A file declared by no crate is still a module, but its `crate::` and `super::` paths resolve to nothing.

## Tests

```sh
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test --locked
```

The real-content test scans this repository and checks the `app/src-tauri` files against the counts in `fixtures/rust/recognizer-baseline.json`. The fixture is `fixtures/rust/sample/` with its expected scan.

## Exit codes

- `0` - the scan was written.
- `2` - a usage error, a `ROOT` that is not a directory, or a file that does not parse.
