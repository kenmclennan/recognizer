# recognizer-scan-csharp

Scans a C# source tree into a scan document, using py-tree-sitter with the tree-sitter-c-sharp grammar. The grammar is built from a pinned git commit (`tool.uv.sources` in `pyproject.toml`), because PyPI's 0.23.5 misreads C# 14 `extension` blocks as constructors without an error node. No .NET SDK is needed: the scanner parses, it never compiles.

```sh
recognizer-scan-csharp run ROOT [--commit SHA] [--modified true|false] [--output FILE]
```

`ROOT` is the repository root and the base of every module id. The commit defaults to `git rev-parse HEAD`, or `null` outside git. Output goes to stdout unless `--output` is given. When some files had damaged spans, one line `recognizer-scan-csharp: D of N files had damaged spans` goes to stderr; when `.fs` or `.vb` files were left out, a second line `recognizer-scan-csharp: left out F .fs and V .vb files` follows.

## Files and projects

The scanner reads `.cs` files outside directories named `bin` and `obj` and dot directories, skipping `*.g.cs`, `*.g.i.cs` and `*.Designer.cs`. A module is one read file, and its id is the file's repository-relative path. Discovery reads `.sln`, `.slnx`, `.csproj` and `Directory.Build.props`; a file belongs to its nearest `.csproj`, and a `<Compile Include ... Link>` adds a file to every project that includes it. A file with no project is its own single-file project.

A project is test code, and is not scanned, when its `.csproj` references `Microsoft.NET.Test.Sdk`, sets `IsTestProject` true, uses `Sdk="MSTest.Sdk"`, or has a package reference whose id starts with xunit, NUnit, MSTest or TUnit or is `Microsoft.AspNetCore.Mvc.Testing`. When the `.csproj` cannot be read, a project named `*.Tests`, `*.UnitTests`, `*.IntegrationTests` or `*.FunctionalTests` is test code. The test projects' directories are listed in `selection.skip_paths`, except a test project that holds a scanned project.

## Edges

Edges are by name resolution; a `using` makes an edge only for a name that is used.

- **Usings.** `using`, `using static`, `using Alias = ...`, `global using` anywhere in the project, and the `.csproj`'s `ImplicitUsings` and `Using` items. The file's own namespace and its parents need no `using`.
- **Uses** come from constructor and primary-constructor parameters, fields, properties, base lists, parameter and return types, object creation, static access, attributes (with the `Attribute` suffix), generic type arguments and `typeof`. Constructor parameters are ordinary `depends` edges; no edge carries a label.
- **Partial types** give an edge to every declaring file, and types nested in a type's other partial files and base types resolve.
- **Visibility.** A `public` or `protected` type crosses a `ProjectReference`, or a package reference to an in-repo project; an `internal` or unmarked type stays in its project and every project a linked `Compile` shares its file with; a `file` type stays in its file.
- **Extension methods.** Every method of a static class whose first parameter is `this`, and every member of a C# 14 `extension` block, is indexed. A call `x.Name()` or `x?.Name()` is an edge to the file declaring one whose namespace is visible, whose accessibility allows it and whose project the caller reaches. Matching is by name only.
- **Foreign and unresolved.** A project's in-repo prefix is its `RootNamespace`, else its `AssemblyName`, else its `.csproj` name. A `using` outside every prefix is foreign when the file has a name it could not resolve; a `using` under a prefix that names no declared namespace is listed in `unresolved_imports`.
- **Supertypes** add `inherits` or `implements` edges carrying `member` and `to_member`.

## Members and entry points

Classes, records, structs and enums are `class`; interfaces are `interface`; delegates and aliases are not members. An abstract class or record carries the tag `abstract`.

A file is an entry point when it has top-level statements, a `static Main`, a controller, a hosted service, a framework-loaded type (`[Migration]`, `[DbContext]`, analyzers, generators, cmdlets), code-behind (`*.xaml.cs`, `*.razor.cs`, `*.cshtml.cs`), or a type the repository registers by convention (`typeof(I).IsAssignableFrom` with an open-generic argument or an assembly enumeration in the same statement, `GetTypesToRegister`, an open-generic `Register`, `Collection.Register`, `Collection.Append` or `RegisterDecorator` with an assembly argument, MediatR handlers where `AddMediatR` appears, FluentValidation validators where `AddValidatorsFromAssembly` appears).

## Markup

The scanner reads `.razor`, `.cshtml` and `.xaml` files outside test projects and adds `depends` edges for the types they name: `@inject`, `@model` and `@inherits`, `@using` as scope, Razor component tags in `.razor` files, and XAML elements, `x:Class` and `x:DataType` through `xmlns:` CLR-namespace mappings. A markup file is not a module; its edges come from its code-behind module, else the nearest module in the project that declares a type, and the edge `line` is a line in the markup file. Names that resolve to nothing add no edge and no foreign name.

## Calls

A call is written for a method or constructor of a scanned type, as a member-to-member `calls` entry.

- A call through a receiver whose type is declared (a parameter of the method, a primary-constructor parameter, a field or a property) is a `call` to the method of that name on the declared type, found on the type, its partial parts and its base types. A parameter wins over a field of the same name.
- A static call `Type.Method(...)`, plain or qualified, on an in-repo type is a `call` to a method tagged `static`.
- An extension call `x.Name(...)` or `x?.Name(...)` is a `call` to the method of that name in each extension declaration the extension rule reaches, unless the receiver is a declared in-repo type that has the method.
- A call to an interface or abstract method is followed by a `dispatch` call to each concrete method of the same name on a type that implements or derives from it.

Calls through `var` locals, typed locals, chains, `new`, a call on the enclosing type's own members, delegates and events, and a method inherited from an unscanned base are not written. Overloads are not told apart, and a local that shadows a field is not modelled. Members of a C# 14 `extension(...)` block are not outline methods, so no call targets them.

## Limits

The grammar fails on `async` used as an identifier in an expression and on preprocessor directives inside comma lists, initializers, base lists and method chains; a damaged file is reported and keeps the declarations that survive. Reflection and convention registration beyond the patterns above, type names inside Razor `@code` and `@{ }` blocks, `@implements`, `@layout`, `@typeparam`, `@attribute` and `@namespace`, XAML type names in attribute values and markup extensions, Razor components declared only in `.razor` files, wildcard `<Compile Include>`, `InternalsVisibleTo`, MSBuild conditions, `var` locals and source-generated types make no edge or call. C# calling F#, VB.NET or native code is not an edge.

## Tests

```sh
uv sync && uv run pytest
```

The real-content test runs against `dotnet/eShop` at `913acea66708a59595351174cee9b29f37179d29`, checked out where `RECOGNIZER_CSHARP_ESHOP` points. It skips when the variable is unset, and fails instead when `RECOGNIZER_REQUIRE_REAL_CONTENT=1`, which CI sets. The counts and the edge-precision floor it checks are in `fixtures/csharp/eshop-baseline.json`.

## Exit codes

- `0` - the scan was written.
- `2` - a usage error or a `ROOT` that is not a directory.
