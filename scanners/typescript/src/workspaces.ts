import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { isSkippedDirectory } from "./files.js";

function readJson(path: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));

    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function patternsOf(manifest: Record<string, unknown>): string[] | null {
  const declared = manifest.workspaces;
  const list = Array.isArray(declared)
    ? declared
    : (declared as { packages?: unknown } | undefined)?.packages;

  if (!Array.isArray(list)) {
    return null;
  }

  return list.filter((entry): entry is string => typeof entry === "string");
}

function globToRegExp(pattern: string): RegExp {
  const body = pattern
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
    .split("**")
    .map((part) =>
      part
        .split("*")
        .map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");

  return new RegExp(`^${body}$`);
}

function packageDirectories(root: string): string[] {
  const found: string[] = [];

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || isSkippedDirectory(entry.name)) {
        continue;
      }

      const path = join(directory, entry.name);

      if (existsSync(join(path, "package.json"))) {
        found.push(path);
      }

      walk(path);
    }
  };

  walk(root);

  return found;
}

export function discoverWorkspaces(root: string): Map<string, string> {
  const workspaces = new Map<string, string>();
  const manifest = readJson(join(root, "package.json"));

  if (!manifest) {
    return workspaces;
  }

  const patterns = patternsOf(manifest);

  if (!patterns) {
    if (typeof manifest.name === "string") {
      workspaces.set(manifest.name, root);
    }

    return workspaces;
  }

  const includes = patterns
    .filter((pattern) => !pattern.startsWith("!"))
    .map(globToRegExp);

  for (const directory of packageDirectories(root)) {
    const path = relative(root, directory).split("\\").join("/");

    if (!includes.some((regexp) => regexp.test(path))) {
      continue;
    }

    const name = readJson(join(directory, "package.json"))?.name;

    if (typeof name === "string") {
      workspaces.set(name, directory);
    }
  }

  return workspaces;
}
