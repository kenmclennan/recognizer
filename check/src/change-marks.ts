import type { RecordedScan } from "./scan.js";

export type MarkScan = Pick<RecordedScan, "modules" | "selection">;

export type Mark = "added" | "modified" | "removed";

export type FileChange = { status: "A" | "M" | "D" | "T"; path: string };

export type MarkedModule = {
  id: string;
  mark: Mark;
  box: "current" | "base" | "none";
};

export type ParsedChanges = { changes: FileChange[]; dropped: number };

const KNOWN = new Set(["A", "M", "D", "T"]);

export function parseNameStatus(stdout: string): ParsedChanges {
  const fields = stdout.split("\0");
  const changes: FileChange[] = [];
  let dropped = 0;

  for (let at = 0; at + 1 < fields.length; at += 2) {
    const status = fields[at] as string;
    const path = fields[at + 1] as string;

    if (KNOWN.has(status)) {
      changes.push({ status: status as FileChange["status"], path });
    } else {
      dropped += 1;
    }
  }

  return { changes, dropped };
}

function modulesOf(scans: MarkScan[]): Set<string> {
  return new Set(scans.flatMap((scan) => scan.modules.map((m) => m.id)));
}

function extensionsOf(scans: MarkScan[]): Set<string> {
  return new Set(scans.flatMap((scan) => scan.selection?.extensions ?? []));
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");

  return dot < 0 ? "" : name.slice(dot);
}

export function changeMarks(
  changes: FileChange[],
  current: MarkScan[],
  base: MarkScan[] | null,
): { modules: MarkedModule[]; unmatched: number } {
  const now = modulesOf(current);
  const before = base === null ? null : modulesOf(base);
  const extensions = new Set([
    ...extensionsOf(current),
    ...(base === null ? [] : extensionsOf(base)),
  ]);
  const grouped = new Map<string, FileChange[]>();
  const removed: MarkedModule[] = [];
  let unmatched = 0;

  for (const change of changes) {
    if (extensions.size > 0 && !extensions.has(extensionOf(change.path))) {
      continue;
    }

    if (now.has(change.path)) {
      grouped.set(change.path, [...(grouped.get(change.path) ?? []), change]);
    } else if (change.status === "D") {
      removed.push({
        id: change.path,
        mark: "removed",
        box: before?.has(change.path) ? "base" : "none",
      });
    } else {
      unmatched += 1;
    }
  }

  const marked: MarkedModule[] = [];

  for (const [id, group] of grouped) {
    const added = group.every((change) => change.status === "A");

    marked.push({ id, mark: added ? "added" : "modified", box: "current" });
  }

  const seen = new Set<string>();
  const modules = [...marked, ...removed].filter((entry) => {
    const key = `${entry.id}:${entry.box}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });

  modules.sort((a, b) => a.id.localeCompare(b.id));

  return { modules, unmatched };
}

export type ChangeClassification = {
  added: string[];
  modified: string[];
  removed: string[];
  elsewhere: string[];
};

export function classifyChanges(
  changes: FileChange[],
  current: MarkScan[],
): ChangeClassification {
  const now = modulesOf(current);
  const extensions = extensionsOf(current);
  const result: ChangeClassification = {
    added: [],
    modified: [],
    removed: [],
    elsewhere: [],
  };

  for (const change of changes) {
    if (extensions.size > 0 && !extensions.has(extensionOf(change.path))) {
      result.elsewhere.push(change.path);
    } else if (now.has(change.path)) {
      (change.status === "A" ? result.added : result.modified).push(
        change.path,
      );
    } else if (change.status === "D") {
      result.removed.push(change.path);
    } else {
      result.elsewhere.push(change.path);
    }
  }

  return result;
}
