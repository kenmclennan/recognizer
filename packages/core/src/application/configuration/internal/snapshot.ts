import type { PlannedChange } from "../../../domain/configuration/setup-changes.js";
import { baseName, joinPath } from "../../../domain/path.js";
import type { SetupFiles } from "../ports/setup-files.js";

export type Snapshot = Map<string, string | null>;

function filesUnder(
  files: SetupFiles,
  directory: string,
  into: string[],
): void {
  const entries = files.children(directory);

  if (entries === null) {
    return;
  }

  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = joinPath(directory, entry.name);

    if (entry.kind === "directory") {
      if (!(baseName(directory) === ".recognizer" && entry.name === "cache")) {
        filesUnder(files, path, into);
      }
    } else if (entry.kind === "file") {
      into.push(path);
    }
  }
}

function recognizerFiles(files: SetupFiles, root: string): string[] {
  const found: string[] = [];

  filesUnder(files, joinPath(root, ".recognizer"), found);

  return found;
}

export function snapshotOf(
  files: SetupFiles,
  root: string,
  changes: PlannedChange[],
): Snapshot {
  const snapshot: Snapshot = new Map();
  const restored = changes.flatMap((change) => change.restores ?? []);

  for (const path of [...recognizerFiles(files, root), ...restored]) {
    snapshot.set(path, files.exists(path) ? files.text(path) : null);
  }

  return snapshot;
}

export function restore(
  files: SetupFiles,
  root: string,
  snapshot: Snapshot,
): void {
  for (const path of recognizerFiles(files, root)) {
    if (!snapshot.has(path)) {
      files.remove(path);
    }
  }

  for (const [path, content] of snapshot) {
    if (content === null) {
      if (files.exists(path)) {
        files.remove(path);
      }
    } else {
      files.write(path, content);
    }
  }
}
