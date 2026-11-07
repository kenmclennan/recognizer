# recognizer-scan-kotlin

Scans a Kotlin source tree into a scan document, using py-tree-sitter with the [fwcd/tree-sitter-kotlin](https://github.com/fwcd/tree-sitter-kotlin) grammar, pinned to a git commit in `pyproject.toml` (`[tool.uv.sources]`, as the C# scanner pins its grammar) with py-tree-sitter pinned exactly. The PyPI `tree-sitter-kotlin` 1.1.0 is the newest release of the other grammar lineage and fails on `when` guards and `context(...)` parameters; a git commit is the only way to get a grammar that parses them, since fwcd's tags stop at 0.3.8, which predates guards.

```sh
recognizer-scan-kotlin ROOT [--commit SHA] [--modified true|false] [--output FILE]
```

`ROOT` is the repository root and the base of every module id. The commit defaults to `git rev-parse HEAD`, or `null` outside git. Output goes to stdout unless `--output` is given. When some files had damaged spans, one line `recognizer-scan-kotlin: D of N files had damaged spans` goes to stderr.

## Files and modules

The scanner reads `.kt` files outside directories named `build` and dot directories. Test code is not scanned: directories named `build`, `test`, `androidTest`, `integrationTest` and `testFixtures`, directories ending `Test`, and files `*Test.kt` and `*Tests.kt` are skipped. `.kts` scripts and `.java` files are not read. A module is one read file, and its id is the file's repository-relative path. A file with no declaration is a module with no members. Module ids changed from directories to files; a source build keeps a cached scan with directory ids until `recognizer scan --force`. The build module of a directory is its nearest ancestor-or-self folder holding `build.gradle`, `build.gradle.kts` or `pom.xml`, and is used to prefer a declaration in the importer's own build when a name is declared in several files.

## Edges

Edges are by name resolution; an import makes an edge only when its name is used.

- **Explicit import** (`import a.b.Name`) goes to the file declaring `Name` in package `a.b`.
- **Aliased import** (`import a.b.Name as N`) counts uses of `N`; `names` holds `Name`.
- **Nested-member import** (`import a.b.Outer.Inner`, `import a.b.Obj.func`) goes to the file declaring `Outer`, with `names` `["Outer.Inner"]`.
- **Wildcard import** (`import a.b.*`) makes one edge per used name the package declares. A wildcard over a package no scanned file declares is foreign.
- **Same package** needs no import: a used name another file declares in the file's own package is an edge, to each declaring file. Names the file declares itself make none.
- **Fully-qualified use** (`a.b.Name` in code) resolves like an import.
- **Foreign and unresolved.** A name declared in no scanned file is foreign, under its package. When its package is equal to or below an in-repo package prefix (for each build module, the longest common dotted prefix of the packages it declares), the import is also listed in `unresolved_imports`, used or not.
- **Supertypes** resolved by the rules above add `inherits` or `implements` edges carrying `member` and `to_member`.

## Members and calls

Classes, objects, companion objects (`Outer.Companion`), data, sealed, enum, annotation and value classes are `class`; interfaces are `interface`; type aliases are `type`; top-level properties are `constant`; functions, extension functions included, are `function` and are named without their receiver. Each member records its `visibility`; `exported` is false only for `private`.

An `abstract class` member carries the tag `abstract`; no other class, interface or `typealias` is tagged.

A call is recorded when both ends are members: a top-level function or object member by name, a constructor, a method on a receiver whose type is declared (a constructor property, a property, a parameter), and dispatch from an abstract or interface method to each implementation. A method a scanned interface does not declare, when the interface has a supertype declared in no scanned file, resolves to the interface itself.

## Entry points

A file is `entry_point: true` when it holds a top-level `fun main`: a function named `main` directly under the file root, with any modifiers and parameters and no receiver type. A `main` that is a member of a class or object, an extension `main` and a `val main` are not marked. In a damaged file the rule reads the pattern hit, which does not tell a receiver `main` apart, so `fun Foo.main()` there is marked.

A file with a top-level `actual` declaration carries `actual_of`, the sorted ids of the files holding a top-level `expect` declaration of the same package and name. Matching is by package and name inside one build module (the nearest `build.gradle`, `build.gradle.kts` or `pom.xml` directory), not by signature or kind, and source sets are not modelled. The key is omitted when no expect file matches; `recognizer check` counts such a file as reached whenever one of those expect files is reached. Library API and Gradle build-logic are not inferred: a library lists its public folders under `warnings.orphan.entry_points`.

## Robustness and limits

A file is damaged when its tree has an error, or a top-level node that is not a declaration (a property's `getter` and `setter` parse as siblings of the property and are not damage). The grammar still errors on some inputs, for example a lambda whose `->` starts the line after its parameter, and such a file is repaired and re-parsed. The repair moves a `->` that starts a line up onto the end of the previous line, inserts `;` before the `}` that closes a body written on one line, inserts `public` before an `annotation class`, `enum class` or untyped `const val` or `const var` that follows annotations, and a file the repair cannot fix is re-parsed in chunks at each top-level declaration. A name index read by pattern adds any declaration the parse lost, without an outline. Short string templates (`"$NAME"`) are read from the text. A damaged file also gains, as uses, every identifier token of its code (comments and string bodies removed, `package` and `import` lines skipped) that the parse did not already give, so a call the grammar lost still makes its edge. The grammar keeps an error local to the span that holds it, so the outlines and calls of the rest of a damaged file are kept.

A damaged span keeps its names; the body of a declaration the parse lost is not read. Local shadowing is not modelled. A function whose body is an expression has no `returns` unless declared. Calls through local values and chains are not resolved. A bean made by a `@Factory`, a runtime choice among implementations and test clients bound to controllers by URL emit nothing. A Kotlin to Java import is foreign, never an edge to a Java file.

## Tests

```sh
uv sync && uv run pytest
```

The real-content test runs against `ArnauAregall/micronaut-kotlin-petclinic-clean-architecture` at `e6e3b49140a55daa148de19111a060e2f62e32be`, checked out where `RECOGNIZER_KOTLIN_PETCLINIC` points. It skips when the variable is unset, and fails instead when `RECOGNIZER_REQUIRE_REAL_CONTENT=1`, which CI sets. The counts and the edge-precision floor it checks are in `fixtures/kotlin/petclinic-baseline.json`.

## Exit codes

- `0` - the scan was written.
- `2` - a usage error or a `ROOT` that is not a directory.
