import { readdirSync, readFileSync } from "node:fs";
import { basename, join, posix, relative, sep } from "node:path";
import { isSkippedDirectory } from "./files.js";

const CONFIG_NAME = /^.+\.config\.(ts|mts|cts|js|mjs|cjs)$/;
const SCRIPT_TAG = /<script\b[^>]*>/gi;
const SRC_ATTRIBUTE = /\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const COMMAND_SEPARATORS = /&&|\|\||[;|&\s]+/;

interface Found {
  manifests: string[];
  pages: string[];
}

function walk(root: string): Found {
  const found: Found = { manifests: [], pages: [] };

  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!isSkippedDirectory(entry.name)) {
          visit(path);
        }
      } else if (entry.name === "package.json") {
        found.manifests.push(path);
      } else if (entry.name.endsWith(".html")) {
        found.pages.push(path);
      }
    }
  };

  visit(root);

  return found;
}

function idOf(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function readManifest(path: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));

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

function manifestTargets(manifest: Record<string, unknown>): string[] {
  const named = [manifest.main, manifest.bin, manifest.exports].flatMap(leaves);

  return named.filter((value) => !value.includes("*"));
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

export function entryPoints(
  root: string,
  files: ReadonlySet<string>,
  sources: (id: string) => string | null,
): Set<string> {
  const marked = new Set<string>();
  const mark = (id: string | null) => {
    if (id !== null && files.has(id)) {
      marked.add(id);
    }
  };
  const { manifests, pages } = walk(root);

  for (const path of manifests) {
    const manifest = readManifest(path);

    if (!manifest) {
      continue;
    }

    const directory = posix.dirname(idOf(root, path));

    for (const value of [
      ...manifestTargets(manifest),
      ...scriptTargets(manifest),
    ]) {
      mark(resolveFrom(directory, value));
    }
  }

  for (const path of pages) {
    let text: string;

    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }

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
    if (CONFIG_NAME.test(basename(id)) || sources(id)?.startsWith("#!")) {
      mark(id);
    }
  }

  return marked;
}
