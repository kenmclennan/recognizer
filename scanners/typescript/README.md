# recognizer-scan-typescript

Scans a repository of Node and React workspaces into a scan document, using the TypeScript compiler API.

```sh
recognizer-scan-typescript ROOT [--commit SHA] [--output FILE]
```

`ROOT` is the repository root and the base of every module id. The commit defaults to `git rev-parse HEAD`, or `null` outside git. Output goes to stdout unless `--output` is given.

## Resolution

Each file is resolved with the options of its own `tsconfig.json`: the nearest one, following `references` to the config that lists the file. A `paths` alias, a `baseUrl` path or a workspace package name that lands on a scanned file becomes an edge to that module, never a foreign node. A workspace package whose build output is missing falls back to its `src/index`. Anything TypeScript resolves into `node_modules`, or cannot resolve at all, is a `foreign:` node named by its package.

## Names and routes

A `depends` edge lists the imported `names` (the original name, never the alias) and is omitted for a whole-module import, which points at the module imported. Each name is followed through re-exports (`export ... from`, `export * from`, a local export list of an imported name) to the module that defines it, which is `to`; the modules it passed through are `via`, in order. An import of names from several defining modules makes one edge per defining module, all on the statement's line. A name the re-exporting module defines itself, a name re-exported from a foreign module and a name found nowhere keep the edge on that module. A cycle of re-exports ends at the module whose next hop would revisit a name already seen.

## Inferred edges

An untyped parameter of a module-level function, or of a method or constructor of a module-level class, whose methods are called in the body (or, once stored on the instance, anywhere in the class) is matched to the repository classes that define all those methods, inherited ones included. Abstract classes are preferred when any match. More than 4 matches, or methods that are all generic, emit nothing. The edge goes to the module defining the matched class, with `names` the called methods and `inferred` holding the parameter, the methods, the class and its direct implementations. An inferred edge is dropped when the importer already has an edge to the same module.

The generic methods, matched case-sensitively:

```text
get set has add delete remove pop push append extend insert clear copy update
keys values items entries close open read write run call apply start stop join
split map filter forEach reduce find includes indexOf slice then catch finally
toString toJSON format strip count index sort reverse encode decode load dump
loads dumps send emit on off
```

## Member outlines and calls

Every member carries an outline, and the document carries a `calls` list. A scanner always writes `calls`, so an empty list means no call was found; a consumer that finds no `calls` key must read it as "this scanner did not record", never as "nothing calls anything".

The outline is in source order. A class or interface has `bases` (as written), `fields` (`name`, and `type` when declared) and `methods` (`name`, `line`, `params`, `returns` when declared, `private` and `tags`). A function has `params`, `returns` when declared, and `tags`. A constant has `value`, its source text with whitespace collapsed and cut to 40 characters (39 and an ellipsis when longer). `tags` is omitted when empty; the tags are `property`, `static`, `classmethod` (Python only), `abstract` and `async`.

A call names both ends as `module::Qualified.name` (`m.py::f`, `m.py::C`, `m.py::C.m`; a constructor call is a call to the class). `line` is where the call starts in `from`'s module. `how` is `call`, `construct`, `inferred` (the receiver's class found as for an inferred edge) or `dispatch` (from an abstract or interface method to each concrete method that implements it, on the line where the abstract method is defined). Calls are sorted and deduplicated. A call is recorded only when both ends are in the scan's outlines, so calls into the standard library, foreign packages, nested classes and definitions inside `if`/`try` are dropped silently. A call is attributed to the enclosing member; calls in a class body, in decorators or at module level have no caller and are dropped, and a module id containing `::` has no calls.

### What the TypeScript scanner resolves

Calls are resolved by the type checker. The program keeps `noResolve` and `noLib`, and its compiler host answers module resolution from the scanner's own resolver, so `paths` aliases, `baseUrl` and workspace packages resolve exactly as they do for edges. A call is resolved to its declaration through the checker (following aliases and re-exports) and recorded when that declaration is a top-level function, a class, or a method of a top-level class or interface listed in a module's outline; `new C()` is a `construct` of the class. An untyped parameter, or a `this.x` field stored from one, goes through the inferred-edge matching and yields `inferred` calls. Dispatch runs from each interface method signature and each `abstract` method to every class that implements or extends (transitively) the owner and declares a non-abstract method of that name itself.

### What it does not resolve

Callees in `node_modules`, the standard library or any foreign or unresolved module, `super(...)` and `super.m(...)` calls, property-assigned arrow functions, nested classes, calls through a type that is `any`, calls in class bodies (including field initialisers), decorators and module level, and untyped receivers that fail the inference gate.

A class constructor is listed as a method named `constructor`; parameter properties are fields. A `set` accessor is not listed; a `get` accessor is a method tagged `property`.

The checker pass builds one program over every scanned file, so a scan takes noticeably longer than before and the document is larger.

## Exit codes

- `0` - the scan was written.
- `2` - a usage error, a `ROOT` that is not a directory, a syntax error in a scanned file or an unreadable `tsconfig.json`. Nothing is written, and every failure is listed on stderr as `path:line: message`.

## Skipped

`node_modules`, `dist`, `build`, `test`, `tests`, `__tests__`, any directory starting with `.`, `*.test.*`, `*.spec.*` and `*.d.ts`. Directory symlinks are not followed.
