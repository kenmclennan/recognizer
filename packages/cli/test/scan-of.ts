import { validateScan } from "../src/index.js";

export function scanOf(
  edges: [string, string][],
  modules: string[] = [],
  entryPoints: string[] = [],
) {
  const ids = new Set([...modules, ...edges.flat()]);

  return validateScan({
    schema_version: 7,
    scanner: { name: "t", version: "0" },
    commit: null,
    modified: false,
    files: [],
    selection: {
      extensions: [],
      skip_directory_names: [],
      skip_directory_prefixes: [],
      skip_directory_suffixes: [],
      skip_directories_containing: [],
      skip_file_globs: [],
    },
    modules: [...ids]
      .filter((id) => !id.startsWith("foreign:"))
      .map((id) => ({
        id,
        language: "python",
        kind: "module",
        members: [],
        ...(entryPoints.includes(id) ? { entry_point: true } : {}),
      })),
    edges: edges.map(([from, to], index) => ({
      from,
      to,
      kind: "depends",
      line: index + 1,
    })),
    foreign: [],
  });
}
