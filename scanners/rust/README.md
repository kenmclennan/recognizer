# recognizer-scan-rust

Scans a Rust source tree into a scan document, using the `syn` parser.

```sh
recognizer-scan-rust run ROOT [--commit SHA] [--modified true|false] [--output FILE]
```

`ROOT` is the repository root and the base of every module id. The commit defaults to `git rev-parse HEAD`, or `null` outside git. Output goes to stdout unless `--output` is given. When a `mod name;` declaration has no file, one line `recognizer-scan-rust: N mod declarations had no file` goes to stderr.

## Files and modules

The scanner reads `.rs` files outside directories named `target`, `node_modules` or `tests` and dot directories. Inline test code is left out too; `benches/`, `examples/` and `build.rs` are scanned. Symlinked directories are not followed. A module is one source file and its id is the file's repository-relative path. A file `syn` rejects fails the scan.

## Crates

A crate is a Cargo package's library or binary target. Every `Cargo.toml` with a `[package]` table defines one: its roots are `src/lib.rs` or `[lib] path`, `src/main.rs`, `src/bin/*.rs`, `src/bin/*/main.rs`, `[[bin]] path`, `build.rs` and each file directly in `examples/` and `benches/`. A path dependency (or a `workspace = true` dependency whose workspace entry has a `path`) to a package in the repository is in-repo and resolves to that package's library root; every other dependency, `std`, `core` and `alloc` are foreign. A package can use its own library by name from its binaries and examples.

## Edges

- **Module tree.** From each crate root, every `mod name;` names a child file: `<dir>/name.rs` then `<dir>/name/mod.rs`, under the directory of a root or `mod.rs` file, or under `<dir>/<stem>/` for any other file. `#[path]` is honoured. A `mod name;` makes a `declares` edge, which keeps the child reached for the orphan check and is not a dependency; an inline `mod name { }` makes none. A `use` of the child stays a `depends` edge.
- **Use paths.** Each leaf of a `use` tree is resolved from `crate`, `self`, `super`, `::dep`, an in-repo dependency, or a child module of the current module. A module leaf makes an edge with no `names`; an item leaf makes one whose `names` holds the item. A glob makes an edge with no `names`.
- **Re-exports.** A path that arrives at a file where the next name is brought in by a `pub use` is followed to the defining module, and each file passed through is recorded in `via`, in order. A cycle, or a chain deeper than 16, stops at the last file reached.
- **Foreign.** A first segment naming `std`, `core`, `alloc` or a foreign dependency makes an edge to `foreign:<name>`. A first segment that resolves to nothing makes no edge.
- **Traits.** `impl Trait for Type` makes an `implements` edge when the trait is defined in a scanned file other than this one. Supertraits are `bases`. `inherits` is never emitted.

## Entry points

A module gets `entry_point: true` in three cases. The first is a Cargo target root: `package.build` (or `build.rs`; none when `build = false`), `src/main.rs`, `src/bin/*.rs`, `src/bin/*/main.rs`, `examples/*.rs`, `examples/*/main.rs`, `benches/*.rs`, `benches/*/main.rs`, and the `path` of any `[[bin]]`, `[[example]]`, `[[bench]]` or `[[test]]` table that names a scanned file. The second is a test file: a file reached only through a `mod x;` declaration gated by a test gate (with or without `#[path]`), or a file whose own inner attribute (`#![cfg(test)]`) is a test gate, together with every file its own `mod y;` declarations name. The byte-reading sensors (the Tests hash and the In-file test hash) apply the same rule, resolving each declaration from the declaring file, its inline module scope and its `#[path]`. A test module adds no edge. The third is the library root, `[lib] path` or else `src/lib.rs`, when that file is scanned: Cargo auto-discovers it as the library target and its dependents load it, so nothing imports it inside the crate. A manifest with `package.autolib = false` and no `[lib]` table has no library target and marks nothing there. A `mod.rs` is not marked: its `mod` declaration is a `declares` edge. Files under a `tests/` directory are not scanned, so they are not marked.

A `macro_rules!` whose body holds a `mod <name>;` token sequence declares those modules at each item-position invocation `<macro>!(...)` of that name in the same crate, as if written at the invocation site: the edge is `declares` and the file resolves from the invoking file. Several definitions of one name all match; `#[macro_use]` and textual scoping are not modelled.

## Members

Structs and enums are `class`, traits `interface`, functions `function`, `const` and `static` `constant`. `exported` is true for any `pub` form except `pub(self)`. Methods from the `impl` blocks of the same file are in the outline of their struct or enum.

## Limits

A test gate is `#[test]` or a `cfg` predicate that requires `test`: `cfg(test)`, `cfg(all(..., test, ...))`, or `cfg(any(...))` when every alternative requires `test`; `cfg(any(test, unix))` and `cfg(not(test))` are production code. Test-gated items are dropped from members, and a `cfg` is read only for this decision.

Path expressions (`a::f()`, `crate::a::Y::new()`, `a::S { .. }`) in function bodies, constants, statics, impl items and trait items are read: a path of two or more segments that resolves to another file of the same package by the `use` rules (`crate`, `self`, `super`, a child module, a `use` binding, the package library name) adds the reached item's name to a `depends` edge, one per target and `via`, kept apart from the `use` edge so a module or glob `use` stays a whole-module use; a name a `use` item already records on that target is not repeated. Single-segment paths, other crates, undeclared names and glob-imported first segments add nothing.

Calls, `cfg` and feature evaluation, macro expansion and macro bodies (beyond the `mod` declarations above), `use` items inside function bodies, type aliases, enum variants, type positions, patterns, qualified-self paths (`<T as a::Tr>::f`) and paths with a leading `::` are not read. An `impl` for a type declared in another file adds nothing to any outline. A file declared by no crate is still a module, but its `crate::` and `super::` paths resolve to nothing.

## Tests

```sh
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test --locked
```

The real-content test scans this repository and checks the `app/src-tauri` files against the counts in `fixtures/rust/recognizer-baseline.json`. The fixture is `fixtures/rust/sample/` with its expected scan.

## Exit codes

- `0` - the scan was written.
- `2` - a usage error, a `ROOT` that is not a directory, or a file that does not parse.
