# recognizer-scan-typescript

Scans a repository of Node and React workspaces into a scan document, using the TypeScript compiler API.

```sh
recognizer-scan-typescript ROOT [--commit SHA] [--output FILE]
```

`ROOT` is the repository root and the base of every module id. The commit defaults to `git rev-parse HEAD`, or `null` outside git. Output goes to stdout unless `--output` is given.

## Resolution

Each file is resolved with the options of its own `tsconfig.json`: the nearest one, following `references` to the config that lists the file. A `paths` alias, a `baseUrl` path or a workspace package name that lands on a scanned file becomes an edge to that module, never a foreign node. A workspace package whose build output is missing falls back to its `src/index`. Anything TypeScript resolves into `node_modules`, or cannot resolve at all, is a `foreign:` node named by its package.

## Exit codes

- `0` - the scan was written.
- `2` - a usage error, a `ROOT` that is not a directory, a syntax error in a scanned file or an unreadable `tsconfig.json`. Nothing is written, and every failure is listed on stderr as `path:line: message`.

## Skipped

`node_modules`, `dist`, `build`, `test`, `tests`, `__tests__`, any directory starting with `.`, `*.test.*`, `*.spec.*` and `*.d.ts`. Directory symlinks are not followed.
