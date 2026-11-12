import { readdirSync, readFileSync } from "node:fs";
import { basename, join, posix, relative, sep } from "node:path";
import ts from "typescript";
import {
  isListed,
  isSkippedDirectory,
  type Listing,
  resolveListing,
} from "./files.js";
import { isUnder, type OutputMapping } from "./tsconfig-options.js";

const CONFIG_NAME = /^.+\.config\.(ts|mts|cts|js|mjs|cjs)$/;
const SCRIPT_TAG = /<script\b[^>]*>/gi;
const SRC_ATTRIBUTE = /\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const COMMAND_SEPARATORS = /&&|\|\||[;|&\s]+/;

interface Found {
  manifests: string[];
  pages: string[];
}

function walk(root: string, listing: Listing | undefined): Found {
  const found: Found = { manifests: [], pages: [] };
  const listed = resolveListing(root, listing);

  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!isSkippedDirectory(entry.name)) {
          visit(path);
        }
      } else if (isListed(listed, root, path)) {
        if (entry.name === "package.json") {
          found.manifests.push(path);
        } else if (entry.name.endsWith(".html")) {
          found.pages.push(path);
        }
      }
    }
  };

  visit(root);

  return found;
}

function idOf(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function readManifest(
  path: string,
  onRead: (path: string) => void,
): Record<string, unknown> | null {
  let text: string;

  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }

  onRead(path);

  try {
    const value: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));

    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function leaves(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(leaves);
  }

  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(leaves);
  }

  return [];
}

function resolveFrom(directory: string, value: string): string | null {
  const resolved = posix.normalize(posix.join(directory, value));

  return resolved === ".." || resolved.startsWith("../") ? null : resolved;
}

function unquote(token: string): string {
  const quote = token[0];

  return token.length >= 2 &&
    (quote === '"' || quote === "'") &&
    token.endsWith(quote)
    ? token.slice(1, -1)
    : token;
}

function manifestValues(manifest: Record<string, unknown>): string[] {
  const strings = [manifest.module, manifest.browser].filter(
    (value) => typeof value === "string",
  );

  return [manifest.main, manifest.bin, manifest.exports, strings].flatMap(
    leaves,
  );
}

function sourceListValues(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

const GLOB_CHARACTERS = /[*?{]/;

function globPattern(glob: string): RegExp {
  let pattern = "";
  let depth = 0;

  for (let at = 0; at < glob.length; at += 1) {
    const char = glob[at] as string;

    if (char === "*" && glob[at + 1] === "*") {
      const slash = glob[at + 2] === "/";

      pattern += slash ? "(?:.*/)?" : ".*";
      at += slash ? 2 : 1;
    } else if (char === "*") {
      pattern += "[^/]*";
    } else if (char === "?") {
      pattern += "[^/]";
    } else if (char === "{") {
      depth += 1;
      pattern += "(?:";
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      pattern += ")";
    } else if (char === "," && depth > 0) {
      pattern += "|";
    } else {
      pattern += char.replace(/[.+^$()|[\]\\{}]/g, "\\$&");
    }
  }

  return new RegExp(`^${pattern}$`);
}

function matchEntries(
  directory: string,
  values: string[],
  files: ReadonlySet<string>,
): string[] {
  const resolve = (value: string) =>
    resolveFrom(directory, value.replace(/^\.\//, ""));
  const matching = (value: string): string[] => {
    const resolved = resolve(value);

    if (resolved === null) {
      return [];
    }

    if (!GLOB_CHARACTERS.test(resolved)) {
      return files.has(resolved) ? [resolved] : [];
    }

    const pattern = globPattern(resolved);

    return [...files].filter((id) => pattern.test(id));
  };
  const kept = values
    .filter((value) => !value.startsWith("!"))
    .flatMap(matching);
  const removed = new Set(
    values
      .filter((value) => value.startsWith("!"))
      .flatMap((value) => matching(value.slice(1))),
  );

  return kept.filter((id) => !removed.has(id));
}

function propertyName(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name)
    ? name.text
    : null;
}

function literalStrings(node: ts.Expression): string[] {
  if (ts.isStringLiteralLike(node)) {
    return [node.text];
  }

  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap((element) => literalStrings(element));
  }

  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.flatMap((property) =>
      ts.isPropertyAssignment(property)
        ? literalStrings(property.initializer)
        : [],
    );
  }

  return [];
}

function configEntryValues(text: string): string[][] {
  const source = ts.createSourceFile(
    "config.ts",
    text,
    ts.ScriptTarget.Latest,
    false,
  );
  const found: string[][] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === "entry") {
      found.push(literalStrings(node.initializer));
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

function patternOf(resolved: string): RegExp | null {
  const parts = resolved.split("*");

  if (parts.length !== 2) {
    return null;
  }

  const escaped = parts.map((part) =>
    part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"),
  );

  return new RegExp(`^${escaped[0]}.+${escaped[1]}$`);
}

function scriptTargets(manifest: Record<string, unknown>): string[] {
  const scripts =
    typeof manifest.scripts === "object" && manifest.scripts !== null
      ? Object.values(manifest.scripts)
      : [];

  return scripts
    .filter((command): command is string => typeof command === "string")
    .flatMap((command) => command.split(COMMAND_SEPARATORS))
    .map(unquote)
    .filter((token) => token !== "" && !token.startsWith("-"));
}

function pageTargets(text: string): string[] {
  const sources: string[] = [];

  for (const tag of text.match(SCRIPT_TAG) ?? []) {
    const match = SRC_ATTRIBUTE.exec(tag);
    const value = match?.[2] ?? match?.[3];

    if (value === undefined) {
      continue;
    }

    const bare = value.split(/[?#]/)[0] ?? "";

    if (bare !== "" && !URL_SCHEME.test(bare) && !bare.startsWith("//")) {
      sources.push(bare);
    }
  }

  return sources;
}

function pageResolutions(directory: string, value: string): string[] {
  if (!value.startsWith("/")) {
    const resolved = resolveFrom(directory, value);

    return resolved === null ? [] : [resolved];
  }

  const found: string[] = [];
  let at = directory;

  for (;;) {
    const resolved = resolveFrom(at, value.slice(1));

    if (resolved !== null) {
      found.push(resolved);
    }

    if (at === "." || at === "") {
      return found;
    }

    at = posix.dirname(at);
  }
}

const OUTPUT_SUFFIXES: [string, string[]][] = [
  [".d.ts", [".ts", ".tsx"]],
  [".d.mts", [".mts"]],
  [".d.cts", [".cts"]],
  [".js", [".ts", ".tsx", ".js", ".jsx"]],
  [".jsx", [".tsx", ".jsx"]],
  [".mjs", [".mts", ".mjs"]],
  [".cjs", [".cts", ".cjs"]],
];

function sourceCandidates(
  resolved: string,
  mappings: OutputMapping[],
): string[] {
  const suffix = OUTPUT_SUFFIXES.filter(([ending]) =>
    resolved.endsWith(ending),
  ).sort((a, b) => b[0].length - a[0].length)[0];

  if (!suffix) {
    return [];
  }

  const [ending, replacements] = suffix;
  const candidates: string[] = [];

  for (const { outDir, rootDir } of mappings) {
    if (!isUnder(resolved, outDir) || resolved === outDir) {
      continue;
    }

    const relativePath =
      outDir === "." ? resolved : resolved.slice(outDir.length + 1);
    const stem = relativePath.slice(0, -ending.length);

    if (stem === "" || stem.endsWith("/")) {
      continue;
    }

    for (const replacement of replacements) {
      candidates.push(posix.normalize(posix.join(rootDir, stem + replacement)));
    }
  }

  return candidates;
}

function outputsOf(id: string, mappings: OutputMapping[]): string[] {
  const outputs: string[] = [];

  for (const { outDir, rootDir } of mappings) {
    if (!isUnder(id, rootDir)) {
      continue;
    }

    const relativePath = rootDir === "." ? id : id.slice(rootDir.length + 1);

    for (const [ending, replacements] of OUTPUT_SUFFIXES) {
      for (const replacement of replacements) {
        if (relativePath.endsWith(replacement)) {
          const stem = relativePath.slice(0, -replacement.length);

          outputs.push(posix.normalize(posix.join(outDir, stem + ending)));
        }
      }
    }
  }

  return outputs;
}

export function entryPoints(
  root: string,
  files: ReadonlySet<string>,
  sources: (id: string) => string | null,
  mappings: (directory: string) => OutputMapping[],
  onRead: (id: string) => void = () => {},
  listing?: Listing,
): Set<string> {
  const marked = new Set<string>();
  const mark = (id: string | null) => {
    if (id !== null && files.has(id)) {
      marked.add(id);
    }
  };
  const { manifests, pages } = walk(root, listing);

  for (const path of manifests) {
    const manifest = readManifest(path, (read) => onRead(idOf(root, read)));

    if (!manifest) {
      continue;
    }

    const directory = posix.dirname(idOf(root, path));

    const published = manifest.private !== true;
    let packageMappings: OutputMapping[] | null = null;

    for (const value of manifestValues(manifest)) {
      const resolved = resolveFrom(directory, value);

      if (resolved === null) {
        continue;
      }

      if (value.includes("*")) {
        const pattern = published ? patternOf(resolved) : null;

        if (pattern === null) {
          continue;
        }

        packageMappings ??= mappings(directory);

        for (const id of files) {
          if (
            pattern.test(id) ||
            outputsOf(id, packageMappings).some((output) =>
              pattern.test(output),
            )
          ) {
            mark(id);
          }
        }

        continue;
      }

      mark(resolved);
      packageMappings ??= mappings(directory);

      const source = sourceCandidates(resolved, packageMappings).find((id) =>
        files.has(id),
      );

      mark(source ?? null);
    }

    for (const value of scriptTargets(manifest)) {
      mark(resolveFrom(directory, value));
    }

    for (const id of matchEntries(
      directory,
      sourceListValues(manifest.zshy),
      files,
    )) {
      mark(id);
    }

    if (!("main" in manifest) && !("exports" in manifest)) {
      mark(resolveFrom(directory, "index.js"));
    }
  }

  for (const path of pages) {
    let text: string;

    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }

    onRead(idOf(root, path));

    const directory = posix.dirname(idOf(root, path));

    for (const value of pageTargets(text)) {
      for (const resolved of pageResolutions(directory, value)) {
        if (files.has(resolved)) {
          mark(resolved);
          break;
        }
      }
    }
  }

  for (const id of files) {
    const text = sources(id);

    if (CONFIG_NAME.test(basename(id)) || text?.startsWith("#!")) {
      mark(id);
    }

    if (text !== null && CONFIG_NAME.test(basename(id))) {
      for (const values of configEntryValues(text)) {
        for (const entry of matchEntries(posix.dirname(id), values, files)) {
          mark(entry);
        }
      }
    }
  }

  return marked;
}
