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

type Located = { id: string; kind: string };

function modulesOf(scans: MarkScan[]): Map<string, Located> {
  const found = new Map<string, Located>();

  for (const scan of scans) {
    for (const module of scan.modules) {
      found.set(module.id, { id: module.id, kind: module.kind });
    }
  }

  return found;
}

function extensionsOf(scans: MarkScan[]): Set<string> {
  return new Set(scans.flatMap((scan) => scan.selection?.extensions ?? []));
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");

  return dot < 0 ? "" : name.slice(dot);
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");

  return slash < 0 ? "" : path.slice(0, slash);
}

function match(
  path: string,
  modules: Map<string, Located>,
): Located | undefined {
  const direct = modules.get(path);

  if (direct !== undefined) {
    return direct;
  }

  const parent = modules.get(directoryOf(path));

  return parent?.kind === "package" ? parent : undefined;
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

    const found = match(change.path, now);

    if (found !== undefined) {
      grouped.set(found.id, [...(grouped.get(found.id) ?? []), change]);
    } else if (change.status === "D") {
      const old = before === null ? undefined : match(change.path, before);

      removed.push(
        old === undefined
          ? { id: change.path, mark: "removed", box: "none" }
          : { id: old.id, mark: "removed", box: "base" },
      );
    } else {
      unmatched += 1;
    }
  }

  const marked: MarkedModule[] = [];

  for (const [id, group] of grouped) {
    const module = now.get(id) as Located;
    const everyAdded = group.every((change) => change.status === "A");
    const added =
      everyAdded &&
      (module.kind !== "package" || before === null || !before.has(id));

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
