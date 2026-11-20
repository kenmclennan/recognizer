import { compileGlob, type Matcher } from "./glob.js";

const TEST_DIRECTORIES = new Set(["test", "tests", "__tests__"]);
export const SCRIPT_EXTENSIONS = [
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
];
const TEST_BASENAME = new RegExp(
  `^(?:test_.*\\.py|.*_test\\.py|conftest\\.py|.*\\.(?:test|spec)\\.(?:${SCRIPT_EXTENSIONS.join("|")}))$`,
);

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

  if (
    basename.endsWith(".cs") &&
    segments
      .slice(0, -1)
      .some((segment) => segment.endsWith("Test") || segment.endsWith("Tests"))
  ) {
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
  policyEntry: Matcher[],
  entryGlobs: string[],
  scanned: boolean,
): boolean {
  if (scanned || policyEntry.some((matches) => matches(id)) || isTestFile(id)) {
    return true;
  }

  return entryGlobs.some((glob) => compileGlob(glob)(id));
}
