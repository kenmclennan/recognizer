import {
  type Call,
  Dependency,
  type Extraction,
  File,
  Library,
  Member,
  Repository,
  type TestImport,
  type UnresolvedImport,
} from "@recognizer/core";
import { validateAcceptedScan } from "../../scan.js";
import type {
  DocumentMember,
  DocumentMethod,
  DocumentModule,
  DocumentSelection,
  ScanDoc,
} from "./scan-document-types.js";

export interface ScanInput {
  language: string;
  document: unknown;
}

function languageOfDocument(document: ScanDoc): string {
  const counts = new Map<string, number>();

  for (const module of document.modules) {
    counts.set(module.language, (counts.get(module.language) ?? 0) + 1);
  }

  const [top] = [...counts].sort(
    ([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0),
  );

  return top?.[0] ?? document.scanner.name.replace(/^recognizer-scan-/, "");
}

export function readScanFile(document: unknown): Repository {
  const valid = validateAcceptedScan(document);

  return assemble([{ language: languageOfDocument(valid), document: valid }]);
}

export function readUncheckedScanFile(document: unknown): Repository {
  const loose = document as ScanDoc;

  return assemble([{ language: languageOfDocument(loose), document: loose }]);
}

export function readRepository(inputs: readonly ScanInput[]): Repository {
  return assemble(
    inputs.map(({ language, document }) => ({
      language,
      document: validateAcceptedScan(document),
    })),
  );
}

export function assemble(
  inputs: readonly { language: string; document: ScanDoc }[],
): Repository {
  const parts = inputs.map(({ language, document }) =>
    translate(language, document),
  );

  return Repository.of({
    files: parts.flatMap((part) => part.files),
    dependencies: parts.flatMap((part) => part.dependencies),
    libraries: parts.flatMap((part) => part.libraries),
    calls: parts.flatMap((part) => part.calls),
    unresolvedImports: parts.flatMap((part) => part.unresolvedImports),
    testImports: parts.flatMap((part) => part.testImports),
    extractions: parts.map((part) => part.extraction),
  });
}

type Part = {
  files: File[];
  dependencies: Dependency[];
  libraries: Library[];
  calls: Call[];
  unresolvedImports: UnresolvedImport[];
  testImports: TestImport[];
  extraction: Extraction;
};

function translate(language: string, document: ScanDoc): Part {
  const hashes = new Map(document.files.map(({ path, hash }) => [path, hash]));
  const libraries = new Set((document.foreign ?? []).map(({ id }) => id));

  const files: File[] = document.modules.map(
    (module) =>
      new File({
        path: module.id,
        language: module.language ?? language,
        kind: module.kind === "module" ? "source" : module.kind,
        hash: hashes.get(module.id) ?? null,
        members: (module.members ?? []).map(memberOf),
        entryPoint: module.entry_point ?? false,
        annotations: module.annotations ?? [],
        actualOf: module.actual_of ?? [],
      }),
  );

  const languageOf = new Map(files.map((file) => [file.path, file.language]));

  const dependencies: Dependency[] = document.edges.map(
    (edge) =>
      new Dependency({
        from: edge.from,
        to: edge.to,
        toLibrary: libraries.has(edge.to),
        language: languageOf.get(edge.from) ?? language,
        kind: edge.kind,
        line: edge.line,
        ...(edge.names === undefined ? {} : { names: edge.names }),
        ...(edge.via === undefined ? {} : { via: edge.via }),
        ...(edge.member === undefined ? {} : { member: edge.member }),
        ...(edge.to_member === undefined ? {} : { toMember: edge.to_member }),
        ...(edge.inferred === undefined ? {} : { inferred: edge.inferred }),
      }),
  );

  return {
    files,
    dependencies,
    libraries: (document.foreign ?? []).map((one) => new Library(one)),
    calls: document.calls ?? [],
    unresolvedImports: document.unresolved_imports ?? [],
    testImports: document.test_imports ?? [],
    extraction: {
      language,
      scanner: document.scanner,
      commit: document.commit,
      modified: document.modified,
      selection: selectionOf(document.selection),
      files: document.files,
    },
  };
}

function selectionOf(selection: DocumentSelection): Extraction["selection"] {
  return {
    extensions: selection.extensions,
    skipDirectoryNames: selection.skip_directory_names,
    skipDirectoryPrefixes: selection.skip_directory_prefixes,
    skipDirectorySuffixes: selection.skip_directory_suffixes,
    skipDirectoriesContaining: selection.skip_directories_containing,
    skipFileGlobs: selection.skip_file_globs,
    ...(selection.skip_paths === undefined
      ? {}
      : { skipPaths: selection.skip_paths }),
    ...(selection.input_file_globs === undefined
      ? {}
      : { inputFileGlobs: selection.input_file_globs }),
    ...(selection.input_absent_paths === undefined
      ? {}
      : { inputAbsentPaths: selection.input_absent_paths }),
  };
}

export function memberOf(member: DocumentMember): Member {
  const { end_line, body_line, methods, tags, ...rest } = member;

  return new Member({
    ...rest,
    ...(end_line === undefined ? {} : { endLine: end_line }),
    ...(body_line === undefined ? {} : { bodyLine: body_line }),
    ...(methods === undefined ? {} : { methods: methods.map(methodOf) }),
    ...(tags === undefined ? {} : { tags: tags as Member["tags"] }),
  });
}

export function documentMember(member: Member): DocumentMember {
  const { endLine, bodyLine, methods, ...rest } = member;

  return {
    ...(rest as Omit<DocumentMember, "end_line" | "body_line" | "methods">),
    ...(endLine === undefined ? {} : { end_line: endLine }),
    ...(bodyLine === undefined ? {} : { body_line: bodyLine }),
    ...(methods === undefined
      ? {}
      : {
          methods: methods.map(
            ({ endLine: end, bodyLine: body, ...method }) => ({
              ...(method as Omit<DocumentMethod, "end_line" | "body_line">),
              ...(end === undefined ? {} : { end_line: end }),
              ...(body === undefined ? {} : { body_line: body }),
            }),
          ),
        }),
  } as DocumentMember;
}

export function documentKind(kind: File["kind"]): DocumentModule["kind"] {
  return kind === "source" ? "module" : kind;
}

function methodOf(
  method: DocumentMethod,
): NonNullable<Member["methods"]>[number] {
  const { end_line, body_line, ...rest } = method;

  return {
    ...rest,
    ...(end_line === undefined ? {} : { endLine: end_line }),
    ...(body_line === undefined ? {} : { bodyLine: body_line }),
  };
}
