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

export function libraryApiHint(id: string): string | null {
  return id.endsWith(".kt") || id.endsWith(".cs") ? LIBRARY_API_HINT : null;
}

export function testOnlySummary(id: string, importers: TestImporter[]): string {
  const shown = importers
    .slice(0, SUMMARY_TEST_FILES)
    .map((importer) => importer.file)
    .join(", ");
  const more = importers.length - SUMMARY_TEST_FILES;
  const count = `${importers.length} test ${importers.length === 1 ? "file" : "files"}`;

  return `${id} is imported only by ${count}: ${shown}${more > 0 ? ` and ${more} more` : ""}; it is not an entry point, so if it only supports tests move it next to them rather than deleting it${libraryApiHint(id) ?? ""}`;
}
