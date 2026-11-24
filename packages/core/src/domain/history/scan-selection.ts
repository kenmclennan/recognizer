import type { ExtractionSelection } from "../extraction.js";

const RECOGNIZER_FOLDER = ".recognizer";

function nameOf(relative: string): string {
  return relative.slice(relative.lastIndexOf("/") + 1);
}

export class ScanSelection {
  constructor(readonly selection: ExtractionSelection) {}

  static globMatches(pattern: string, name: string): boolean {
    const [first, ...rest] = pattern.split("*") as [string, ...string[]];

    if (!name.startsWith(first)) {
      return false;
    }

    let remaining = name.slice(first.length);
    const last = rest.pop();

    if (last === undefined) {
      return remaining === "";
    }

    for (const part of rest) {
      const at = remaining.indexOf(part);

      if (at < 0) {
        return false;
      }

      remaining = remaining.slice(at + part.length);
    }

    return remaining.length >= last.length && remaining.endsWith(last);
  }

  underSkipPath(relative: string): boolean {
    return (this.selection.skipPaths ?? []).some(
      (skipped) =>
        skipped === "." ||
        relative === skipped ||
        relative.startsWith(`${skipped}/`),
    );
  }

  markersOf(directory: string): string[] {
    return this.selection.skipDirectoriesContaining.map(
      (marker) => `${directory}/${marker}`,
    );
  }

  skipsDirectory(relativeDirectory: string, present: ReadonlySet<string>) {
    const name = nameOf(relativeDirectory);

    return (
      name === RECOGNIZER_FOLDER ||
      this.underSkipPath(relativeDirectory) ||
      this.selection.skipDirectoryNames.includes(name) ||
      this.selection.skipDirectoryPrefixes.some((prefix) =>
        name.startsWith(prefix),
      ) ||
      this.selection.skipDirectorySuffixes.some((suffix) =>
        name.endsWith(suffix),
      ) ||
      this.markersOf(relativeDirectory).some((marker) => present.has(marker))
    );
  }

  acceptsFile(name: string): boolean {
    return (
      this.selection.extensions.some((extension) => name.endsWith(extension)) &&
      !this.selection.skipFileGlobs.some((glob) =>
        ScanSelection.globMatches(glob, name),
      )
    );
  }

  private inSkippedDirectory(
    relative: string,
    present: ReadonlySet<string>,
    ownParentCounts: boolean,
  ): boolean {
    const parts = relative.split("/");

    parts.pop();

    const last = Math.max(parts.length - 1, 0);
    let directory = "";

    for (const [at, part] of parts.entries()) {
      directory = directory === "" ? part : `${directory}/${part}`;

      if (
        (ownParentCounts || at !== last) &&
        this.skipsDirectory(directory, present)
      ) {
        return true;
      }
    }

    return false;
  }

  accepts(relative: string, present: ReadonlySet<string> = new Set()): boolean {
    return (
      !this.inSkippedDirectory(relative, present, true) &&
      !this.underSkipPath(relative) &&
      this.acceptsFile(nameOf(relative))
    );
  }

  readsByName(
    relative: string,
    present: ReadonlySet<string> = new Set(),
  ): boolean {
    const name = nameOf(relative);

    if (this.underSkipPath(relative)) {
      return false;
    }

    if (this.selection.skipDirectoriesContaining.includes(name)) {
      return !this.inSkippedDirectory(relative, present, false);
    }

    return (
      (this.selection.inputFileGlobs ?? []).some((glob) =>
        ScanSelection.globMatches(glob, name),
      ) && !this.inSkippedDirectory(relative, present, true)
    );
  }

  readsInputs(): boolean {
    return (
      (this.selection.inputFileGlobs ?? []).length > 0 ||
      this.selection.skipDirectoriesContaining.length > 0
    );
  }

  markersAlong(paths: Iterable<string>): string[] {
    if (this.selection.skipDirectoriesContaining.length === 0) {
      return [];
    }

    const directories = new Set<string>();

    for (const path of paths) {
      const parts = path.split("/");

      parts.pop();

      let directory = "";

      for (const part of parts) {
        directory = directory === "" ? part : `${directory}/${part}`;
        directories.add(directory);
      }
    }

    return [...directories].flatMap((directory) => this.markersOf(directory));
  }
}
