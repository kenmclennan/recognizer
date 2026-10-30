# recognizer-scan-kotlin

Scans a Kotlin source tree into a scan document, using py-tree-sitter with the tree-sitter-kotlin grammar (both pinned exactly, because the misparse the scanner works around belongs to one grammar version).

```sh
recognizer-scan-kotlin ROOT [--commit SHA] [--modified true|false] [--output FILE]
```

`ROOT` is the repository root and the base of every module id. The commit defaults to `git rev-parse HEAD`, or `null` outside git. Output goes to stdout unless `--output` is given. When some files had damaged spans, one line `recognizer-scan-kotlin: D of N files had damaged spans` goes to stderr.

## Files and modules

The scanner reads `.kt` files outside directories named `build` and dot directories. Test code is scanned. `.kts` scripts and `.java` files are not read. A module is a directory holding at least one read file, and its id is the directory's path (`.` for the repository root). The build module of a directory is its nearest ancestor-or-self folder holding `build.gradle`, `build.gradle.kts` or `pom.xml`, and is used to prefer a declaration in the importer's own build when a name is declared in several directories.

## Edges

Edges are by name resolution; an import makes an edge only when its name is used.

- **Explicit import** (`import a.b.Name`) goes to the directory declaring `Name` in package `a.b`.
- **Aliased import** (`import a.b.Name as N`) counts uses of `N`; `names` holds `Name`.
- **Nested-member import** (`import a.b.Outer.Inner`, `import a.b.Obj.func`) goes to the directory declaring `Outer`, with `names` `["Outer.Inner"]`.
- **Wildcard import** (`import a.b.*`) makes one edge per used name the package declares. A wildcard over a package no scanned file declares is foreign.
- **Same package** needs no import: a used name another directory declares in the file's own package is an edge. Names in the file's own directory make none.
- **Fully-qualified use** (`a.b.Name` in code) resolves like an import.
- **Foreign and unresolved.** A name declared in no scanned file is foreign, under its package. When its package is equal to or below an in-repo package prefix (for each build module, the longest common dotted prefix of the packages it declares), the import is also listed in `unresolved_imports`, used or not.
- **Supertypes** resolved by the rules above add `inherits` or `implements` edges carrying `member` and `to_member`.

## Members and calls

Classes, objects, companion objects (`Outer.Companion`), data, sealed, enum, annotation and value classes are `class`; interfaces are `interface`; type aliases are `type`; top-level properties are `constant`; functions, extension functions included, are `function` and are named without their receiver. Each member records its `visibility`; `exported` is false only for `private`.

A call is recorded when both ends are members: a top-level function or object member by name, a constructor, a method on a receiver whose type is declared (a constructor property, a property, a parameter), and dispatch from an abstract or interface method to each implementation. A method a scanned interface does not declare, when the interface has a supertype declared in no scanned file, resolves to the interface itself.

## Robustness and limits

A file is damaged when its tree has an error, or a top-level node that is not a declaration (several stacked annotations on an `annotation class` come back as an expression). A damaged file is re-parsed in chunks at each top-level declaration, and a name index read by pattern adds any declaration the parse lost, without an outline. Short string templates (`"$NAME"`) are read from the text.

Damaged spans keep their names but not their bodies. Local shadowing is not modelled. A function whose body is an expression has no `returns` unless declared. Calls through local values and chains are not resolved. A bean made by a `@Factory`, a runtime choice among implementations and test clients bound to controllers by URL emit nothing. A Kotlin to Java import is foreign, never an edge to a Java file.

## Tests

```sh
uv sync && uv run pytest
```

The real-content test runs against `ArnauAregall/micronaut-kotlin-petclinic-clean-architecture` at `e6e3b49140a55daa148de19111a060e2f62e32be`, checked out where `RECOGNIZER_KOTLIN_PETCLINIC` points. It skips when the variable is unset, and fails instead when `RECOGNIZER_REQUIRE_REAL_CONTENT=1`, which CI sets. The counts and the edge-precision floor it checks are in `fixtures/kotlin/petclinic-baseline.json`.

## Exit codes

- `0` - the scan was written.
- `2` - a usage error or a `ROOT` that is not a directory.
