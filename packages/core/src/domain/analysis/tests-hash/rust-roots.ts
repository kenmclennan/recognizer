import { posix } from "./posix.js";
import type { Declaration } from "./rust-scan.js";

const ROOT_NAMES = new Set(["lib.rs", "main.rs", "build.rs"]);

function isRootFile(path: string): boolean {
  const name = posix.basename(path);
  const parent = posix.dirname(path);

  if (ROOT_NAMES.has(name)) {
    return true;
  }

  const parentName = posix.basename(parent);

  if (parentName === "examples" || parentName === "benches") {
    return true;
  }

  return (
    parentName === "bin" && posix.basename(posix.dirname(parent)) === "src"
  );
}

export type Roots = {
  roots: ReadonlySet<string>;
  covered: ReadonlySet<string>;
};

function joinRoot(directory: string, relative: string): string | null {
  const parts: string[] = [];

  for (const part of (directory === ""
    ? relative
    : `${directory}/${relative}`
  ).split("/")) {
    if (part === "" || part === ".") {
      continue;
    }

    if (part === "..") {
      if (parts.length === 0) {
        return null;
      }

      parts.pop();
    } else {
      parts.push(part);
    }
  }

  return parts.join("/");
}

function asTable(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function manifestRoots(
  listed: readonly string[],
  read: (path: string) => string | null,
  parse: (text: string) => Record<string, unknown> | null,
): Roots {
  const paths = new Set(listed);
  const sources = [...paths].filter((path) => path.endsWith(".rs")).sort();
  const roots = new Set<string>();
  const covered = new Set<string>();

  for (const manifest of [...paths].sort()) {
    if (posix.basename(manifest) !== "Cargo.toml") {
      continue;
    }

    const text = read(manifest);
    const table = text === null ? null : parse(text);
    const packageTable = asTable(table?.package);

    if (table === null || typeof packageTable?.name !== "string") {
      continue;
    }

    const parent = posix.dirname(manifest);
    const directory = parent === "." ? "" : parent;

    covered.add(directory);

    const declare = (relative: string): void => {
      const found = joinRoot(directory, relative);

      if (found !== null && paths.has(found)) {
        roots.add(found);
      }
    };
    const libraryPath = asTable(table.lib)?.path;

    declare(typeof libraryPath === "string" ? libraryPath : "src/lib.rs");
    declare("src/main.rs");

    const build = packageTable.build;

    if (build !== false) {
      declare(typeof build === "string" ? build : "build.rs");
    }

    for (const kind of ["bin", "example", "bench", "test"]) {
      const entries = table[kind];

      for (const entry of Array.isArray(entries) ? entries : []) {
        const path = asTable(entry)?.path;

        if (typeof path === "string") {
          declare(path);
        }
      }
    }

    for (const folder of ["src/bin", "examples", "benches"]) {
      const prefix =
        directory === "" ? `${folder}/` : `${directory}/${folder}/`;

      for (const path of sources) {
        if (!path.startsWith(prefix)) {
          continue;
        }

        const rest = path.slice(prefix.length);
        const slashes = rest.split("/").length - 1;

        if (slashes === 0 || (slashes === 1 && rest.endsWith("/main.rs"))) {
          roots.add(path);
        }
      }
    }
  }

  return { roots, covered };
}

function isRootIn(roots: Roots, path: string): boolean {
  let directory = posix.dirname(path);

  for (;;) {
    if (roots.covered.has(directory === "." ? "" : directory)) {
      return roots.roots.has(path);
    }

    const next = posix.dirname(directory);

    if (next === directory) {
      return isRootFile(path);
    }

    directory = next;
  }
}

function joinModule(base: string, tail: string): string | null {
  if (tail.startsWith("/")) {
    return null;
  }

  const joined = posix.normalize(base === "" ? tail : `${base}/${tail}`);

  return joined.startsWith("..") || joined === "." ? null : joined;
}

function moduleCandidates(
  file: string,
  declaration: Declaration,
  roots: Roots,
): string[] {
  const parent = posix.dirname(file);
  const directory = parent === "." ? "" : parent;

  if (declaration.path !== null) {
    const found = joinModule(directory, declaration.path);

    return found === null ? [] : [found];
  }

  const name = posix.basename(file);
  const stem = name.slice(0, -3);
  let base =
    isRootIn(roots, file) || name === "mod.rs"
      ? directory
      : (joinModule(directory, stem) ?? "");

  for (const segment of declaration.scope) {
    base = joinModule(base, segment) ?? "";
  }

  return [`${declaration.name}.rs`, `${declaration.name}/mod.rs`]
    .map((tail) => joinModule(base, tail))
    .filter((found): found is string => found !== null);
}

export function resolvedDeclaration(
  file: string,
  declaration: Declaration,
  index: ReadonlySet<string>,
  roots: Roots,
): string | null {
  return (
    moduleCandidates(file, declaration, roots).find((found) =>
      index.has(found),
    ) ?? null
  );
}
