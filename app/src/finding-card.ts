import type { FindingRecord } from "recognizer";
import { EMPTY_CATALOG, type FindingCatalog } from "./finding-catalog";
import { sentenceOf, shortName } from "./finding-sentence";
import type { FindingRow } from "./findings-order";

export type CardRowModel =
  | { kind: "module"; module: string; name: string; folder: string }
  | { kind: "member"; module: string; name: string; folder: string }
  | { kind: "edge"; from: string; to: string }
  | {
      kind: "test";
      file: string;
      name: string;
      folder: string;
      names: string[];
    };

export type CardModel = {
  id: string;
  name: string;
  folder: string;
  sentence: string;
  rows: CardRowModel[];
};

function folderOf(path: string): string {
  const at = path.lastIndexOf("/");

  return at === -1 ? "" : path.slice(0, at);
}

function isMemberFinding(record: FindingRecord): boolean {
  return (
    (record.evidence.members?.length ?? 0) > 0 &&
    record.kind !== "unused_exports" &&
    record.kind !== "private_imports"
  );
}

function subjectOf(row: FindingRow): { name: string; folder: string } {
  const { record } = row;

  if (isMemberFinding(record)) {
    const member = record.evidence.members?.[0];

    if (member !== undefined) {
      return { name: member.name, folder: folderOf(member.module) };
    }
  }

  const module = record.evidence.modules[0] ?? "";

  return { name: shortName(module), folder: folderOf(module) };
}

export function cardOf(
  row: FindingRow,
  catalog: FindingCatalog = EMPTY_CATALOG,
): CardModel {
  const { record } = row;
  const subject = subjectOf(row);
  const rows: CardRowModel[] = [];

  if (isMemberFinding(record) || record.kind === "private_imports") {
    for (const member of record.evidence.members ?? []) {
      rows.push({
        kind: "member",
        module: member.module,
        name: member.name,
        folder: folderOf(member.module),
      });
    }
  } else {
    for (const module of record.evidence.modules) {
      rows.push({
        kind: "module",
        module,
        name: shortName(module),
        folder: folderOf(module),
      });
    }
  }

  if (record.kind === "orphan") {
    for (const importer of record.evidence.test_importers ?? []) {
      rows.push({
        kind: "test",
        file: importer.file,
        name: shortName(importer.file),
        folder: folderOf(importer.file),
        names: importer.names,
      });
    }
  }

  if (record.kind === "unused_exports") {
    const byFile = new Map<string, string[]>();

    for (const member of record.evidence.members ?? []) {
      for (const file of member.test_files ?? []) {
        byFile.set(file, [...(byFile.get(file) ?? []), member.name]);
      }
    }

    for (const file of [...byFile.keys()].sort()) {
      rows.push({
        kind: "test",
        file,
        name: shortName(file),
        folder: folderOf(file),
        names: byFile.get(file) ?? [],
      });
    }
  }

  for (const edge of record.kind === "private_imports"
    ? []
    : (record.evidence.edges ?? [])) {
    rows.push({ kind: "edge", from: edge.from, to: edge.to });
  }

  return {
    id: row.id,
    name: subject.name,
    folder: subject.folder,
    sentence: sentenceOf({ record, reported: row.reported }, catalog),
    rows,
  };
}

export function isAbsent(
  row: CardRowModel,
  boxFor: (id: string) => string,
  boxIds: ReadonlySet<string>,
): boolean {
  return (
    row.kind !== "edge" &&
    row.kind !== "test" &&
    !boxIds.has(boxFor(row.module))
  );
}
