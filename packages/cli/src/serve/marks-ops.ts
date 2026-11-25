import {
  type ChangeClassification,
  changeMarks,
  classifyOpened,
  type FileChange,
  type HistoricalPorts,
  type MarkedFile,
  type Repository,
  rangeMembers,
  readChangeRange,
  scansAtCommit,
} from "@recognizer/core";
import { type MemberMarkKind, memberMarks } from "../member-marks.js";
import { repositoryOfScans } from "../structure-read.js";
import { ArgsError } from "./wire.js";

export type MarksAnswer =
  | { ok: true; files: MarkedFile[]; unmatched: number }
  | { ok: false; reason: string };

export type MemberMarksWire = [string, [string, MemberMarkKind][] | null][];

const FILE_STATUSES = new Set(["A", "M", "D", "T", "R"]);

function fileChangesOf(
  changes: readonly { status: string; path: string; from?: string }[],
): FileChange[] {
  return changes
    .filter((change) => FILE_STATUSES.has(change.status))
    .map((change) => ({
      status: change.status as FileChange["status"],
      path: change.path,
      ...(change.from === undefined ? {} : { from: change.from }),
    }));
}

async function scansOf(
  ports: HistoricalPorts,
  root: string,
  commit: string | null,
): Promise<Repository | null> {
  if (commit === null) {
    return null;
  }

  const read = await scansAtCommit(ports, root, commit);

  return read.ok ? repositoryOfScans(read.scans) : null;
}

export async function viewMarks(
  ports: HistoricalPorts,
  root: string,
  base: string,
  head: string,
  present: Repository,
): Promise<MarksAnswer> {
  const range = readChangeRange(ports, root, base, head);

  if (range === null) {
    return { ok: false, reason: "the change could not be read" };
  }

  if (range.headCommit === null || range.baseCommit === null) {
    return { ok: false, reason: "the change names a ref git does not know" };
  }

  const headScans = (await scansOf(ports, root, range.headCommit)) ?? present;
  const baseScans = await scansOf(ports, root, range.baseCommit);
  const found = changeMarks(fileChangesOf(range.changes), headScans, baseScans);

  return { ok: true, files: found.files, unmatched: found.unmatched };
}

export async function viewMembers(
  ports: HistoricalPorts,
  root: string,
  base: string,
  head: string,
  present: Repository,
): Promise<{ marks: MemberMarksWire }> {
  const members = await rangeMembers(ports, root, base, head);
  const marked = await viewMarks(ports, root, base, head, present);

  if (!members.ok || !marked.ok) {
    return { marks: [] };
  }

  const baseScans = repositoryOfScans(members.baseScans);
  const headScans = repositoryOfScans(members.headScans);
  const marks = memberMarks({
    marked: marked.files,
    base: baseScans,
    head: headScans,
    files: members.files.map((file) => ({
      path: file.path,
      base_path: file.basePath,
      base_text: file.baseText,
      head_text: file.headText,
    })),
  });

  return {
    marks: [...marks].map(([id, byName]) => [
      id,
      byName === null ? null : [...byName],
    ]),
  };
}

export function classifyOpenedOp(
  args: Record<string, unknown>,
): ChangeClassification {
  const { marked, changes } = args;

  if (!Array.isArray(marked) || !Array.isArray(changes)) {
    throw new ArgsError(["marked and changes must be lists"]);
  }

  return classifyOpened(
    fileChangesOf(changes as { status: string; path: string }[]),
    marked as MarkedFile[],
  );
}
