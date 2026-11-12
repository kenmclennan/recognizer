# Duplication equivalence goldens

Data the TypeScript duplication check (`check/src/duplication/`) is tested against. They were produced once by the Python duplication sensor and the shared `functions.py` and `identity.py` at base commit `1755593674ca859eed13100d62e11986c6bb0770` (`origin/main` when REC-522 was built).

- `findings.<name>.json` - the complete findings the Python sensor wrote at the default settings for `fixtures/duplication/corpus/<language>` (`python`, `typescript`, `kotlin`, `rust`, `csharp`), `fixtures/duplication/sample` (`sample`) and `fixtures/crap/corpus` (`crap-corpus`, which has none).
- `functions.<language>.json` - every function `find_functions` finds in the language's files under the corpus, sample, `fixtures/crap/corpus` and `sources/`, with its qualified name, start line and identity from `assign_identities`.
- `histogram.<grammar>.json` - the node-type histogram of one file per grammar from py-tree-sitter at the pinned versions, which the vendored wasm grammars must reproduce.
- `sources/` - extra sources for the identity goldens: a duplicate method name, a TypeScript arrow bound to a variable, a C# arrow property and indexer, a Rust generic `impl`, a Kotlin companion object, a `.tsx` and a `.js` file.

The goldens are frozen. The Python duplication package is gone, so `findings.*.json` cannot be regenerated; a change to them needs a decision to change the method, not a rerun. `sensors/tests/test_function_identities.py` regenerates `functions.*.json` from `functions.py` and `identity.py` and fails if either drifts, and `check/test/duplication-functions.test.ts` holds the TypeScript port to the same files, so one file pins both sides.
