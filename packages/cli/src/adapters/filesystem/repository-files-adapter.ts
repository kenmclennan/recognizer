import { join } from "node:path";
import {
  type RepositoryFiles,
  type RepositoryListing,
  type RepositoryListingRequest,
  SKIPPED_DIRECTORIES,
} from "@recognizer/core";
import type { Io } from "../../cli.js";

const NOT_A_REPOSITORY = "not a git repository";

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class RepositoryFilesAdapter implements RepositoryFiles {
  constructor(private readonly io: Io) {}

  list(root: string, request: RepositoryListingRequest): RepositoryListing {
    const flags = ["-z", "--cached", "--others", "--exclude-standard"];
    const pathspec = request.excludeOwnState
      ? ["--", ".", ":!.recognizer"]
      : [];
    const listed = this.io.run("git", [
      "-C",
      root,
      "ls-files",
      ...flags,
      ...pathspec,
    ]);

    if (listed.started && listed.status === 0) {
      const paths = listed.stdout.split("\0").filter((path) => path !== "");

      return {
        from: "git",
        paths: request.onlyPresent
          ? paths.filter((path) => this.io.exists(join(root, path)))
          : paths,
      };
    }

    if (request.fallback === "walk") {
      return this.walked(root);
    }

    return { from: "none", warning: warningOf(listed) };
  }

  private walked(root: string): RepositoryListing {
    const found: string[] = [];

    try {
      this.walk(root, "", found);
    } catch {
      return { from: "none", warning: null };
    }

    return { from: "walk", paths: found };
  }

  private walk(root: string, directory: string, into: string[]): void {
    const entries = [...this.io.readDir(join(root, directory))].sort((a, b) =>
      compareText(a.name, b.name),
    );

    for (const entry of entries) {
      const path = directory === "" ? entry.name : `${directory}/${entry.name}`;

      if (entry.kind === "directory") {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          this.walk(root, path, into);
        }
      } else if (entry.kind === "file") {
        into.push(path);
      }
    }
  }
}

function warningOf(result: {
  started: boolean;
  status: number | null;
  stderr: string;
}): string | null {
  if (!result.started) {
    return null;
  }

  const message = result.stderr.trim();

  if (message.includes(NOT_A_REPOSITORY)) {
    return null;
  }

  return message.split("\n")[0] || `exit ${result.status}`;
}
