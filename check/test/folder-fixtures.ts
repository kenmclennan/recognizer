import { type Scan, validateScan } from "../src/index.js";

export interface Spec {
  id: string;
  exports?: ("class" | "interface" | "type" | "function" | "abstract")[];
}

function member(kind: NonNullable<Spec["exports"]>[number], index: number) {
  return kind === "abstract"
    ? {
        name: `m${index}`,
        exported: true,
        kind: "class",
        line: index + 1,
        tags: ["abstract"],
      }
    : { name: `m${index}`, exported: true, kind, line: index + 1 };
}

export function scanOf(
  specs: Spec[],
  edges: [string, string][],
  extra: { inferred?: [string, string][] } = {},
): Scan {
  return validateScan({
    schema_version: 5,
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
    modules: specs.map((spec) => ({
      id: spec.id,
      language: "typescript",
      kind: "module",
      members: (spec.exports ?? []).map(member),
    })),
    edges: [
      ...edges.map(([from, to], index) => ({
        from,
        to,
        kind: "depends",
        line: index + 1,
      })),
      ...(extra.inferred ?? []).map(([from, to]) => ({
        from,
        to,
        kind: "depends",
        line: 1,
        inferred: {
          parameter: "p",
          methods: ["m"],
          class: "C",
          implementations: [],
        },
      })),
    ],
    foreign: [],
  });
}

export const WORKED: Spec[] = [
  { id: "app/domain/order.ts", exports: ["class"] },
  { id: "app/domain/money.ts", exports: ["class"] },
  { id: "app/ports/store.ts", exports: ["interface", "type"] },
  { id: "app/application/place.ts", exports: ["function"] },
  { id: "app/adapters/sql.ts", exports: ["class"] },
  { id: "app/util/fmt.ts", exports: ["function"] },
  { id: "app/util/dates.ts", exports: ["function"] },
  { id: "app/contracts/audit.ts", exports: ["interface"] },
];

export const WORKED_EDGES: [string, string][] = [
  ["app/application/place.ts", "app/domain/order.ts"],
  ["app/application/place.ts", "app/ports/store.ts"],
  ["app/adapters/sql.ts", "app/ports/store.ts"],
  ["app/adapters/sql.ts", "foreign:pg"],
  ["app/domain/order.ts", "app/domain/money.ts"],
  ["app/domain/order.ts", "app/util/fmt.ts"],
  ["app/util/fmt.ts", "foreign:lodash"],
  ["app/util/dates.ts", "foreign:dayjs"],
  ["app/contracts/audit.ts", "foreign:zod"],
];
