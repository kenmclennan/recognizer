import { compileGlob } from "./glob.js";

const TEST_DIRECTORIES = new Set(["test", "tests", "__tests__"]);
const INDEX_STEMS = new Set(["index", "__init__", "main", "mod", "lib"]);
const TEST_BASENAME =
  /^(?:test_.*\.py|.*_test\.py|conftest\.py|.*\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs))$/;

export function isLiteralPath(glob: string): boolean {
  return !glob.includes("*") && !glob.includes("?");
}

function stemOf(basename: string): string {
  const dot = basename.lastIndexOf(".");

  return dot > 0 ? basename.slice(0, dot) : basename;
}

export function isTestFile(id: string): boolean {
  const segments = id.split("/");
  const basename = segments[segments.length - 1] as string;

  if (segments.slice(0, -1).some((segment) => TEST_DIRECTORIES.has(segment))) {
    return true;
  }

  if (TEST_BASENAME.test(basename)) {
    return true;
  }

  const stem = stemOf(basename);

  return stem.endsWith("Test") || stem.endsWith("Tests");
}

export function isEntryPoint(
  id: string,
  literalPaths: Set<string>,
  entryGlobs: string[],
  scanned: boolean,
): boolean {
  if (scanned || literalPaths.has(id) || isTestFile(id)) {
    return true;
  }

  const basename = id.slice(id.lastIndexOf("/") + 1);

  if (INDEX_STEMS.has(stemOf(basename))) {
    return true;
  }

  return entryGlobs.some((glob) => compileGlob(glob)(id));
}
