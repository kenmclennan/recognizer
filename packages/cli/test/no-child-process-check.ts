import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export type Exception = { path: string; reason: string };

export type SpawnReport = {
  flagged: string[];
  excepted: string[];
  unlisted: string[];
  stale: string[];
};

const FOLDERS = ["adapter-contract", "end-to-end"];
const SPAWNING =
  /node:(?:child_process|worker_threads)|\bnew Serve\(|\bspawnSync\(/;
const IMPORT_PATH = /(?:from|import\()\s*["'](\.[^"']*)["']/g;

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : filesUnder(path);
    }

    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

export function listTypeScriptFiles(
  repositoryRoot: string,
  testDirectory: string,
): string[] {
  const tracked = (() => {
    try {
      return execFileSync(
        "git",
        [
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
          "--",
          testDirectory,
        ],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      )
        .split("\n")
        .filter((line) => line.endsWith(".ts"));
    } catch {
      return null;
    }
  })();

  const files =
    tracked === null || tracked.length === 0
      ? filesUnder(join(repositoryRoot, testDirectory)).map((file) =>
          relative(repositoryRoot, file),
        )
      : tracked;

  return files.filter((file) => existsSync(join(repositoryRoot, file))).sort();
}

export function inAllowedFolder(path: string): boolean {
  return path.split("/").some((segment) => FOLDERS.includes(segment));
}

function withoutTypeImports(text: string): string {
  return text.replace(/^import type [^;]*;$/gm, "");
}

function localImports(file: string, text: string): string[] {
  const found: string[] = [];

  for (const match of text.matchAll(IMPORT_PATH)) {
    const base = resolve(dirname(file), (match[1] ?? "").replace(/\.js$/, ""));

    for (const candidate of [`${base}.ts`, join(base, "index.ts")]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        found.push(candidate);
        break;
      }
    }
  }

  return found;
}

export function spawningFiles(
  repositoryRoot: string,
  files: string[],
  excepted: string[] = [],
): Set<string> {
  const memo = new Map<string, boolean>();
  const scanned = new Set(files.map((file) => join(repositoryRoot, file)));
  const excludedAbsolute = new Set(
    excepted.map((file) => join(repositoryRoot, file)),
  );

  const reaches = (absolute: string, visiting: Set<string>): boolean => {
    const known = memo.get(absolute);

    if (known !== undefined) {
      return known;
    }

    if (visiting.has(absolute) || excludedAbsolute.has(absolute)) {
      return false;
    }

    visiting.add(absolute);

    const text = withoutTypeImports(readFileSync(absolute, "utf8"));
    const result =
      SPAWNING.test(text) ||
      localImports(absolute, text)
        .filter((next) => scanned.has(next))
        .some((next) => reaches(next, visiting));

    visiting.delete(absolute);
    memo.set(absolute, result);

    return result;
  };

  return new Set(
    files.filter((file) => reaches(join(repositoryRoot, file), new Set())),
  );
}

export function readBaseline(path: string): string[] {
  return existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"))
    : [];
}

export function checkSpawning(options: {
  repositoryRoot: string;
  testDirectory: string;
  baseline: string[];
  exceptions: Exception[];
}): SpawnReport {
  const files = listTypeScriptFiles(
    options.repositoryRoot,
    options.testDirectory,
  );
  const excepted = options.exceptions.map((one) => one.path);
  const spawning = spawningFiles(options.repositoryRoot, files, excepted);
  const flagged = files.filter(
    (file) => spawning.has(file) && !inAllowedFolder(file),
  );

  return {
    flagged,
    excepted: files.filter((file) => excepted.includes(file)),
    unlisted: flagged.filter(
      (file) => !options.baseline.includes(file) && !excepted.includes(file),
    ),
    stale: options.baseline.filter(
      (line) => !flagged.includes(line) || excepted.includes(line),
    ),
  };
}
