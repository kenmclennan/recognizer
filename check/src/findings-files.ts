import { join } from "node:path";
import type { DirEntry, Io } from "./cli.js";
import {
  type FindingsDocument,
  validateFindings,
} from "./findings-document.js";

export function findingsFolder(root: string): string {
  return join(root, ".recognizer", "cache", "findings");
}

export function findingsFile(root: string, name: string): string {
  return join(findingsFolder(root), `${name}.json`);
}

export function writeFindings(
  io: Io,
  root: string,
  document: FindingsDocument,
): void {
  const target = findingsFile(root, document.sensor.name);
  const temp = `${target}.tmp`;

  try {
    io.writeFile(temp, `${JSON.stringify(document, null, 2)}\n`);
    io.rename(temp, target);
  } catch (error) {
    io.remove(temp);

    throw error;
  }
}

export type ReadOutcome =
  | {
      name: string;
      status: "read";
      document: FindingsDocument;
      reported?: true;
    }
  | {
      name: string;
      status: "stale";
      document: FindingsDocument;
      reported?: true;
    }
  | { name: string; status: "invalid"; reason: string }
  | { name: string; status: "unregistered" };

function listed(io: Io, root: string): string[] {
  let entries: DirEntry[];

  try {
    entries = io.readDir(findingsFolder(root));
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.kind === "file" && entry.name.endsWith(".json"))
    .map((entry) => entry.name.slice(0, -".json".length))
    .sort();
}

export function readFindingsFiles(
  io: Io,
  root: string,
  commit: string | null,
  skip: string[] = [],
  allowed: string[] | null = null,
): ReadOutcome[] {
  return listed(io, root)
    .filter((name) => !skip.includes(name))
    .map((name): ReadOutcome => {
      const outside = allowed !== null && !allowed.includes(name);
      let document: FindingsDocument;

      try {
        document = validateFindings(
          JSON.parse(io.readFile(findingsFile(root, name))),
          { name },
        );
      } catch (error) {
        return outside
          ? { name, status: "unregistered" }
          : { name, status: "invalid", reason: (error as Error).message };
      }

      if (
        outside &&
        (name === "structure" || document.reported_at === undefined)
      ) {
        return { name, status: "unregistered" };
      }

      const reported = outside ? { reported: true as const } : {};

      return document.commit === commit
        ? { name, status: "read", document, ...reported }
        : { name, status: "stale", document, ...reported };
    });
}
