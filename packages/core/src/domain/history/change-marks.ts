import type { ExtractionSelection } from "../extraction.js";
import type { Repository } from "../repository.js";
import { ScanSelection } from "./scan-selection.js";

export type Mark = "added" | "modified" | "removed" | "renamed";

export type FileChange = {
  status: "A" | "M" | "D" | "T" | "R";
  path: string;
  from?: string;
};

export type MarkedFile = {
  id: string;
  mark: Mark;
  box: "current" | "base" | "none";
  from?: string;
};

function selectionsOf(repository: Repository): ExtractionSelection[] {
  return repository.extractions.map(({ selection }) => selection);
}

function modulesOf(repository: Repository): Set<string> {
  return new Set(repository.files.map((file) => file.path));
}

export type ChangeStatus = Mark | "elsewhere";

export function statusOf(
  change: FileChange,
  selections: ExtractionSelection[],
): ChangeStatus {
  if (
    selections.length > 0 &&
    !selections.some((selection) =>
      new ScanSelection(selection).accepts(change.path),
    )
  ) {
    return "elsewhere";
  }

  switch (change.status) {
    case "A":
      return "added";
    case "D":
      return "removed";
    case "R":
      return "renamed";
    default:
      return "modified";
  }
}

export function changeMarks(
  changes: FileChange[],
  head: Repository,
  base: Repository | null,
): { files: MarkedFile[]; unmatched: number } {
  const now = modulesOf(head);
  const before = base === null ? null : modulesOf(base);
  const selections = [
    ...selectionsOf(head),
    ...(base === null ? [] : selectionsOf(base)),
  ];
  const marked = new Map<string, MarkedFile>();
  let unmatched = 0;

  for (const change of changes) {
    const status = statusOf(change, selections);

    if (status === "elsewhere") {
      continue;
    }

    if (status === "removed") {
      if (before === null || before.has(change.path)) {
        marked.set(change.path, {
          id: change.path,
          mark: "removed",
          box: before === null ? "none" : "base",
        });
      } else {
        unmatched += 1;
      }

      continue;
    }

    if (!now.has(change.path)) {
      unmatched += 1;

      continue;
    }

    marked.set(change.path, {
      id: change.path,
      mark: status,
      box: "current",
      ...(status === "renamed" && change.from !== undefined
        ? { from: change.from }
        : {}),
    });
  }

  return {
    files: [...marked.values()].sort((a, b) => a.id.localeCompare(b.id)),
    unmatched,
  };
}

export type ChangeClassification = {
  added: string[];
  modified: string[];
  renamed: string[];
  removed: string[];
  elsewhere: string[];
};

export function classifyChanges(
  changes: FileChange[],
  selections: ExtractionSelection[],
): ChangeClassification {
  const result: ChangeClassification = {
    added: [],
    modified: [],
    renamed: [],
    removed: [],
    elsewhere: [],
  };

  for (const change of changes) {
    result[statusOf(change, selections)].push(change.path);
  }

  return result;
}

export function classifyOpened(
  changes: FileChange[],
  marked: MarkedFile[],
): ChangeClassification {
  const result: ChangeClassification = {
    added: [],
    modified: [],
    renamed: [],
    removed: [],
    elsewhere: [],
  };
  const byId = new Map(marked.map((entry) => [entry.id, entry]));

  for (const change of changes) {
    const entry = byId.get(change.path);

    if (entry !== undefined && entry.box !== "none") {
      result[entry.mark].push(change.path);
    } else {
      result.elsewhere.push(change.path);
    }
  }

  return result;
}
