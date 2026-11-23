import type { ExtractionSelection, Repository } from "@recognizer/core";

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

export type ParsedChanges = { changes: FileChange[]; dropped: number };

const KNOWN = new Set(["A", "M", "D", "T"]);

export function parseNameStatus(stdout: string): ParsedChanges {
  const fields = stdout.split("\0");
  const changes: FileChange[] = [];
  let dropped = 0;
  let at = 0;

  while (at + 1 < fields.length) {
    const status = fields[at] as string;

    if (status.startsWith("R") || status.startsWith("C")) {
      const from = fields[at + 1] as string;
      const path = fields[at + 2];

      at += 3;

      if (status.startsWith("R") && path !== undefined) {
        changes.push({ status: "R", path, from });
      } else {
        dropped += 1;
      }

      continue;
    }

    const path = fields[at + 1] as string;

    at += 2;

    if (KNOWN.has(status)) {
      changes.push({ status: status as FileChange["status"], path });
    } else {
      dropped += 1;
    }
  }

  return { changes, dropped };
}

export function parseNameStatusLine(
  status: string,
  rest: string,
): FileChange | null {
  if (status.startsWith("R")) {
    const tab = rest.indexOf("\t");

    return tab < 0 || tab === rest.length - 1
      ? null
      : { status: "R", path: rest.slice(tab + 1), from: rest.slice(0, tab) };
  }

  return KNOWN.has(status) && rest !== ""
    ? { status: status as FileChange["status"], path: rest }
    : null;
}

const RECOGNIZER_FOLDER = ".recognizer";

function globMatches(pattern: string, name: string): boolean {
  const parts = pattern.split("*");
  const first = parts[0] as string;

  if (!name.startsWith(first)) {
    return false;
  }

  let remaining = name.slice(first.length);
  const rest = parts.slice(1);
  const last = rest.pop();

  if (last === undefined) {
    return remaining === "";
  }

  for (const part of rest) {
    const found = remaining.indexOf(part);

    if (found < 0) {
      return false;
    }

    remaining = remaining.slice(found + part.length);
  }

  return remaining.length >= last.length && remaining.endsWith(last);
}

function underSkipPath(
  selection: ExtractionSelection,
  relative: string,
): boolean {
  return (selection.skipPaths ?? []).some(
    (skipped) =>
      skipped === "." ||
      relative === skipped ||
      relative.startsWith(`${skipped}/`),
  );
}

function skipsDirectory(
  selection: ExtractionSelection,
  directory: string,
  markerExists: MarkerCheck | undefined,
): boolean {
  const name = directory.slice(directory.lastIndexOf("/") + 1);

  return (
    name === RECOGNIZER_FOLDER ||
    underSkipPath(selection, directory) ||
    selection.skipDirectoryNames.includes(name) ||
    selection.skipDirectoryPrefixes.some((prefix) => name.startsWith(prefix)) ||
    selection.skipDirectorySuffixes.some((suffix) => name.endsWith(suffix)) ||
    (markerExists !== undefined &&
      selection.skipDirectoriesContaining.some((marker) =>
        markerExists(directory, marker),
      ))
  );
}

export type MarkerCheck = (directory: string, marker: string) => boolean;

export function scannedBy(
  path: string,
  selection: ExtractionSelection,
  markerExists?: MarkerCheck,
): boolean {
  const parts = path.split("/");
  const name = parts.pop() as string;
  let directory = "";

  for (const part of parts) {
    directory = directory === "" ? part : `${directory}/${part}`;

    if (skipsDirectory(selection, directory, markerExists)) {
      return false;
    }
  }

  return (
    !underSkipPath(selection, path) &&
    selection.extensions.some((extension) => name.endsWith(extension)) &&
    !selection.skipFileGlobs.some((glob) => globMatches(glob, name))
  );
}

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
    !selections.some((selection) => scannedBy(change.path, selection))
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
