# recognizer-scan-python

Scans a Python source tree into a scan document, using the standard library `ast` module.

```sh
recognizer-scan-python ROOT [--commit SHA] [--output FILE] [--source-root DIR ...]
```

`ROOT` is the repository root and the base of every module id. `--source-root` names a directory under `ROOT` that imports are resolved from, and repeats; the default is `ROOT` itself. The commit defaults to `git rev-parse HEAD`, or `null` outside git. Output goes to stdout unless `--output` is given.

## Names and routes

A `depends` edge lists the imported `names` (the original name, never the alias) and is omitted for a whole-module import, which points at the module imported. Each name is followed through re-exports (a package `__init__.py`, `from x import y`, `from x import *`) to the module that defines it, which is `to`; the modules it passed through are `via`, in order. An import of names from several defining modules makes one edge per defining module, all on the statement's line. A name the re-exporting module defines itself, a name re-exported from a foreign module and a name found nowhere keep the edge on that module. A cycle of re-exports ends at the module whose next hop would revisit a name already seen.

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

## Exit codes

- `0` - the scan was written.
- `2` - a usage error, a `ROOT` or `--source-root` that is not a directory, or a file that does not parse. Nothing is written.
