import type { FindingRecord } from "recognizer";
import { sentenceOf, shortName } from "./finding-sentence";
import type { FindingRow } from "./findings-order";

export type CardRowModel =
  | { kind: "module"; module: string; name: string; folder: string }
  | { kind: "member"; module: string; name: string; folder: string }
  | { kind: "edge"; from: string; to: string };

export type CardModel = {
  id: string;
  name: string;
  folder: string;
  sentence: string;
  rows: CardRowModel[];
};

const FOLDER_KINDS = new Set(["folder_cycle", "stable_dependencies"]);

function folderOf(path: string): string {
  const at = path.lastIndexOf("/");

  return at === -1 ? "" : path.slice(0, at);
}

function splitFolder(folder: string): { name: string; folder: string } {
  const at = folder.lastIndexOf("/");

  return at === -1
    ? { name: folder, folder: "" }
    : { name: folder.slice(at + 1), folder: folder.slice(0, at) };
}

function isMemberFinding(record: FindingRecord): boolean {
  return (
    (record.evidence.members?.length ?? 0) > 0 &&
    record.kind !== "unused_exports"
  );
}

export function folderSubject(record: FindingRecord): string | null {
  if (record.kind === "folder_cycle") {
    return record.id.slice("folder_cycle:".length).split(",")[0] ?? null;
  }

  if (record.kind === "stable_dependencies") {
    return (
      record.id.slice("stable_dependencies:".length).split("->")[0] ?? null
    );
  }

  if (
    record.kind === "policy_drift" &&
    record.id.startsWith("policy_drift:folder:")
  ) {
    return record.id.slice("policy_drift:folder:".length);
  }

  return null;
}

function subjectOf(row: FindingRow): { name: string; folder: string } {
  const { record } = row;

  if (isMemberFinding(record)) {
    const member = record.evidence.members?.[0];

    if (member !== undefined) {
      return { name: member.name, folder: folderOf(member.module) };
    }
  }

  if (
    FOLDER_KINDS.has(record.kind) ||
    (record.kind === "policy_drift" &&
      record.id.startsWith("policy_drift:folder:"))
  ) {
    const folder = folderSubject(record);

    if (folder !== null && folder !== "") {
      return splitFolder(folder);
    }
  }

  if (
    record.kind === "policy_drift" &&
    record.id.startsWith("policy_drift:entry:")
  ) {
    return { name: record.id.slice("policy_drift:entry:".length), folder: "" };
  }

  const module = record.evidence.modules[0] ?? "";

  return { name: shortName(module), folder: folderOf(module) };
}

export function cardOf(row: FindingRow): CardModel {
  const { record } = row;
  const subject = subjectOf(row);
  const rows: CardRowModel[] = [];

  if (record.kind === "folder_cycle" && record.evidence.cuts !== undefined) {
    for (const cut of record.evidence.cuts) {
      rows.push({ kind: "edge", from: cut.from, to: cut.to });
    }

    return {
      id: row.id,
      name: subject.name,
      folder: subject.folder,
      sentence: sentenceOf({ record, reported: row.reported }),
      rows,
    };
  }

  if (isMemberFinding(record)) {
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

  for (const edge of record.evidence.edges ?? []) {
    rows.push({ kind: "edge", from: edge.from, to: edge.to });
  }

  return {
    id: row.id,
    name: subject.name,
    folder: subject.folder,
    sentence: sentenceOf({ record, reported: row.reported }),
    rows,
  };
}

export function isAbsent(
  row: CardRowModel,
  boxFor: (id: string) => string,
  boxIds: ReadonlySet<string>,
): boolean {
  return row.kind !== "edge" && !boxIds.has(boxFor(row.module));
}
