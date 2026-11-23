import type {
  Dependency,
  Extraction,
  ExtractionSelection,
  File,
  Member,
  Repository,
} from "@recognizer/core";

type DocMethod = Omit<
  NonNullable<Member["methods"]>[number],
  "endLine" | "bodyLine"
> & { end_line?: number; body_line?: number };

export type DocMember = Omit<
  Member,
  "endLine" | "bodyLine" | "methods" | "tags"
> & {
  end_line?: number;
  body_line?: number;
  methods?: DocMethod[];
  tags?: string[];
};

export type DocEdge = Omit<
  Dependency,
  "toLibrary" | "language" | "toMember"
> & {
  to_member?: string;
};

export type DocModule = {
  id: string;
  language?: string;
  kind?: "module" | "package" | "interface";
  members?: DocMember[];
  entry_point?: boolean;
  annotations?: string[];
  actual_of?: string[];
};

export type DocScan = {
  modules: DocModule[];
  edges: DocEdge[];
  foreign?: { id: string; name: string }[];
  calls?: Repository["calls"][number][];
  unresolved_imports?: Repository["unresolvedImports"][number][];
  test_imports?: Repository["testImports"][number][];
  scanner?: { name: string; version: string };
  commit?: string | null;
  modified?: boolean | null;
  files?: { path: string; hash: string }[];
  selection?: Record<string, string[] | undefined>;
};

const SELECTION: ExtractionSelection = {
  extensions: [],
  skipDirectoryNames: [],
  skipDirectoryPrefixes: [],
  skipDirectorySuffixes: [],
  skipDirectoriesContaining: [],
  skipFileGlobs: [],
};

function selectionOf(selection: DocScan["selection"]): ExtractionSelection {
  if (selection === undefined) {
    return SELECTION;
  }

  const camel = (key: string) =>
    key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

  return {
    ...SELECTION,
    ...Object.fromEntries(
      Object.entries(selection).map(([key, value]) => [camel(key), value]),
    ),
  };
}

function folderOf(path: string): string | null {
  const at = path.lastIndexOf("/");

  return at === -1 ? null : path.slice(0, at);
}

function memberOf(member: DocMember): Member {
  const { end_line, body_line, methods, tags, ...rest } = member;

  return {
    ...rest,
    ...(end_line === undefined ? {} : { endLine: end_line }),
    ...(body_line === undefined ? {} : { bodyLine: body_line }),
    ...(methods === undefined
      ? {}
      : {
          methods: methods.map(
            ({ end_line: end, body_line: body, ...one }) => ({
              ...one,
              ...(end === undefined ? {} : { endLine: end }),
              ...(body === undefined ? {} : { bodyLine: body }),
            }),
          ),
        }),
    ...(tags === undefined ? {} : { tags: tags as Member["tags"] }),
  };
}

function partOf(scan: DocScan, language: string): Repository {
  const hashes = new Map((scan.files ?? []).map((one) => [one.path, one.hash]));
  const libraries = new Set((scan.foreign ?? []).map(({ id }) => id));
  const files: File[] = (scan.modules ?? []).map((module) => ({
    path: module.id,
    language: module.language ?? language,
    folder: folderOf(module.id),
    kind:
      module.kind === "module" || module.kind === undefined
        ? "source"
        : module.kind,
    hash: hashes.get(module.id) ?? null,
    members: (module.members ?? []).map(memberOf),
    entryPoint: module.entry_point ?? false,
    annotations: module.annotations ?? [],
    actualOf: module.actual_of ?? [],
  }));
  const languageOf = new Map(files.map((file) => [file.path, file.language]));
  const extraction: Extraction = {
    language,
    scanner: scan.scanner ?? { name: "recognizer-scan-test", version: "0" },
    commit: scan.commit ?? null,
    modified: scan.modified ?? null,
    selection: selectionOf(scan.selection),
    files: scan.files ?? [],
  };

  return {
    folders: [],
    files,
    dependencies: (scan.edges ?? []).map(({ to_member, ...edge }) => ({
      ...edge,
      toLibrary: libraries.has(edge.to),
      language: languageOf.get(edge.from) ?? language,
      ...(to_member === undefined ? {} : { toMember: to_member }),
    })),
    libraries: scan.foreign ?? [],
    calls: scan.calls ?? [],
    unresolvedImports: scan.unresolved_imports ?? [],
    testImports: scan.test_imports ?? [],
    extractions: [extraction],
  };
}

export function repositoryFrom(
  scans: readonly DocScan[],
  language = "python",
): Repository {
  const parts = scans.map((scan) => partOf(scan, language));

  const files = parts.flatMap((part) => part.files);
  const folders = new Map<string, { path: string; parent: string | null }>();

  for (const file of files) {
    let folder = file.folder;

    while (folder !== null && !folders.has(folder)) {
      folders.set(folder, { path: folder, parent: folderOf(folder) });
      folder = folderOf(folder);
    }
  }

  return {
    folders: [...folders.values()],
    files,
    dependencies: parts.flatMap((part) => part.dependencies),
    libraries: parts.flatMap((part) => part.libraries),
    calls: parts.flatMap((part) => part.calls),
    unresolvedImports: parts.flatMap((part) => part.unresolvedImports),
    testImports: parts.flatMap((part) => part.testImports),
    extractions: parts.flatMap((part) => part.extractions),
  };
}

export type DocField = NonNullable<Member["fields"]>[number];

export function membersFrom(members: DocMember[]): readonly Member[] {
  return (
    partOf({ modules: [{ id: "m", members }], edges: [] }, "python").files[0]
      ?.members ?? []
  );
}
