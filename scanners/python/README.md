# recognizer-scan-python

Scans a Python source tree into a scan document, using the standard library `ast` module.

```sh
recognizer-scan-python ROOT [--commit SHA] [--output FILE] [--source-root DIR ...]
```

`ROOT` is the repository root and the base of every module id. `--source-root` names a directory under `ROOT` that imports are resolved from, and repeats; given, the list is used exactly, with no detection and no `ROOT` appended. Without it the scanner detects the source roots the repository declares and appends `ROOT` last, so an absolute import of the repository's own package resolves in a src layout. Detection reads, in order: the root `pyproject.toml` (setuptools `package-dir` and `packages.find where`, hatch wheel `packages` and `sources`), the root `setup.cfg` (`package_dir`, `packages.find where`), then every directory named `src`, at any depth, that holds a package. A declared root that is missing, absolute or contains `..` is ignored, and an unreadable declaration contributes nothing. Nested `pyproject.toml` files and other build backends' declarations are not read. Module ids stay repository-relative paths. Without `--source-root`, a module in a script folder (a directory with no `__init__.py`) also resolves an import no root matches against the modules beside it, as Python does for a running script; a module inside a package never does, and an explicit list turns this off. The commit defaults to `git rev-parse HEAD`, or `null` outside git. Output goes to stdout unless `--output` is given.

## Names and routes

A `depends` edge lists the imported `names` (the original name, never the alias) and is omitted for a whole-module import, which points at the module imported. Each name is followed through re-exports (a package `__init__.py`, `from x import y`, `from x import *`) to the module that defines it, which is `to`; the modules it passed through are `via`, in order. An import of names from several defining modules makes one edge per defining module, all on the statement's line. A name the re-exporting module defines itself, a name re-exported from a foreign module and a name found nowhere keep the edge on that module. A cycle of re-exports ends at the module whose next hop would revisit a name already seen.

## Test imports

The files the scanner skips as tests (a directory named `test` or `tests`, and `conftest.py`) are read for their imports only, with the resolution an ordinary module gets, and each import of a scanned module becomes one `test_imports` record `{ from, to, names? }` in the scan: `from` the test file's path, `to` the module id, `names` the sorted names it takes from that module and absent when any of its imports takes the whole module. Records are sorted by `from` then `to`, one per pair, and the key is written even when empty. A test file is never a module, edge or file in the scan, and one that cannot be parsed contributes nothing and does not fail the scan.

## Entry points

A module named by a `pyproject.toml` `[project.scripts]` or `[project.gui-scripts]` value (`module.path:callable` or `module.path`) carries `entry_point: true`. The module path is resolved from the `pyproject.toml`'s directory, through the scan's module index or the directory and its `src` folder, so a `src` layout resolves as an import does; a name that resolves to a package marks its `__init__.py`, and one that resolves to no scanned module marks nothing. Every `pyproject.toml` outside the skipped directories is read, a file that fails to parse is ignored, and each one that declares a script is listed in `files` with its hash. A package's `__init__.py` is marked when its package is loaded: Python runs it when the package or any module below it is imported, so it carries `entry_point: true` when some module under the package, at any depth, is the target of an import edge or a `test_imports` record from a module outside the package, or is itself an entry point. A package nothing loads stays unmarked, and the `__init__.py` importing its own submodules does not count, since that would put a cycle in every package. A top-level `__init__.py` with no directory is never marked. `[project.entry-points]` plugin groups, `setup.py` and `setup.cfg` entry points are not read.

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

The outline is in source order. A class or interface has `bases` (as written), `fields` (`name`, `type` when declared, `line` and `private`) and `methods` (`name`, `line`, `params` (each `name`, and `type` when declared), `returns` when declared, `private` and `tags`). A function has `params` (each `name`, and `type` when declared), `returns` when declared, and `tags`. A constant has `value`, its source text with whitespace collapsed and cut to 40 characters (39 and an ellipsis when longer). `tags` is omitted when empty; the tags are `property`, `static`, `classmethod` (Python only), `abstract` and `async`.

A call names both ends as `module::Qualified.name` (`m.py::f`, `m.py::C`, `m.py::C.m`; a constructor call is a call to the class). `line` is where the call starts in `from`'s module. `how` is `call`, `construct`, `inferred` (the receiver's class found as for an inferred edge) or `dispatch` (from an abstract or interface method to each concrete method that implements it, on the line where the abstract method is defined). Calls are sorted and deduplicated. A call is recorded only when both ends are in the scan's outlines, so calls into the standard library, foreign packages, nested classes and definitions inside `if`/`try` are dropped silently. A call is attributed to the enclosing member; calls in a class body, in decorators or at module level have no caller and are dropped, and a module id containing `::` has no calls.

### What the Python scanner resolves

- A direct name defined in the same module, and an imported name, followed through re-exports to the defining module.
- A module-alias attribute (`import m as x; x.f()`, `from pkg import mod; mod.f()`), including a function-local import.
- A local variable assigned from a constructor call or annotated with a repository class, then `v.m()`.
- `self.x.m()` where `self.x` is typed in `__init__` by an annotation or a constructor call (or by an annotated parameter), and `self.m()` and `cls.m()`, resolved to the nearest class defining `m` among the class and its repository bases, left to right, depth first.
- A chained call on a constructed object (`C(...).m()`).
- A parameter annotated with a repository class (`Optional[C]`, `C | None` and `"C"` unwrap to `C`).
- An untyped parameter, by the inferred-edge method-set matching: one `inferred` call per matched class, to the class that defines the method.
- Dispatch from a method declared abstract (`@abc.abstractmethod`, or any method of a class with a `Protocol` base) to the method of the same name on each repository subclass that defines it itself, following inheritance. A subclass that only inherits the method is skipped; a deeper subclass that defines it is reached.

### What it does not resolve

Standard-library and foreign callees, `super()` calls, a receiver typed only by a function's return annotation (`make().m()`), a class that satisfies a Protocol only structurally with no base naming it (it receives no dispatch), an ABC method without `@abstractmethod` (not abstract), untyped receivers that fail the inference gate (more than 4 matches, or only generic methods), nested classes.

Underscore-named module-level definitions (a leading `_` that is not a dunder) are members with `exported: false`, unless `__all__` lists them. Dunder names (`__all__`, `__version__`) are not members. A module's `kind` ignores underscore-named members.

Module-level constants are `NAME = expr` and `NAME: T = expr` statements at module level with one plain name target, including inside `if`, `try`, `with`, `for`, `while` and `match` blocks but not inside a function or class. A name defined in several blocks and not at top level is one member at its first line.

`__all__` is read from string literals only: a list or tuple assignment (or a `+` concatenation of them), `+=`, `.extend([...])` and `.append("...")`, in order, with a later assignment replacing an earlier one. Anything else, including a change made inside a block, leaves `__all__` undefined.

## Exit codes

- `0` - the scan was written.
- `2` - a usage error, a `ROOT` or `--source-root` that is not a directory, or a file that does not parse. Nothing is written.
