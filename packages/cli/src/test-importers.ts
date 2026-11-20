import type { TestImporter } from "./findings-document.js";
import type { Scan } from "./scan.js";

export const SUMMARY_TEST_FILES = 3;

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function testImportersOf(scan: Scan): Map<string, TestImporter[]> {
  const grouped = new Map<string, Map<string, Set<string>>>();

  for (const record of scan.test_imports ?? []) {
    const files = grouped.get(record.to) ?? new Map<string, Set<string>>();
    const names = files.get(record.from) ?? new Set<string>();

    for (const name of record.names ?? []) {
      names.add(name);
    }

    files.set(record.from, names);
    grouped.set(record.to, files);
  }

  const importers = new Map<string, TestImporter[]>();

  for (const [module, files] of grouped) {
    importers.set(
      module,
      [...files.keys()].sort(compare).map((file) => ({
        file,
        names: [...(files.get(file) ?? [])].sort(compare),
      })),
    );
  }

  return importers;
}

export const LIBRARY_API_HINT =
  "; a library can list its public API in warnings.orphan.entry_points";

export function libraryApiHint(_id: string): string {
  return LIBRARY_API_HINT;
}

export function testOnlySummary(id: string, importers: TestImporter[]): string {
  const shown = importers
    .slice(0, SUMMARY_TEST_FILES)
    .map((importer) => importer.file)
    .join(", ");
  const more = importers.length - SUMMARY_TEST_FILES;
  const count = `${importers.length} test ${importers.length === 1 ? "file" : "files"}`;

  return `${id} is imported only by ${count}: ${shown}${more > 0 ? ` and ${more} more` : ""}; it is not an entry point, so if it only supports tests move it next to them rather than deleting it${LIBRARY_API_HINT}`;
}

export interface TestOnlyName {
  name: string;
  testFiles: string[];
}

function filesClause(files: string[]): string {
  const shown = files.slice(0, SUMMARY_TEST_FILES).join(", ");
  const more = files.length - SUMMARY_TEST_FILES;

  return `${shown}${more > 0 ? ` and ${more} more` : ""}`;
}

function testOnlyWords(marked: TestOnlyName[]): {
  names: string;
  them: string;
  their: string;
  files: string;
} {
  const files = [...new Set(marked.flatMap((entry) => entry.testFiles))].sort(
    compare,
  );

  return {
    names: marked.map((entry) => entry.name).join(", "),
    them: marked.length === 1 ? "it" : "them",
    their: marked.length === 1 ? "its" : "their",
    files: filesClause(files),
  };
}

export function unusedTestOnlyClause(marked: TestOnlyName[]): string {
  const words = testOnlyWords(marked);

  return `; only tests import ${words.names} (${words.files}), so if nothing outside the repository uses ${words.them}, delete ${words.them} with ${words.their} tests${LIBRARY_API_HINT}`;
}

export function unusedTestOnlySentence(marked: TestOnlyName[]): string {
  const words = testOnlyWords(marked);

  return `Only tests import ${words.names}: if nothing outside the repository uses ${words.them}, delete ${words.them} with ${words.their} tests${LIBRARY_API_HINT}.`;
}
