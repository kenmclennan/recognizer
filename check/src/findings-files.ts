import { join } from "node:path";
import type { DirEntry, Io } from "./cli.js";
import {
  type FindingsDocument,
  validateFindings,
} from "./findings-document.js";
import type { Scan } from "./scan.js";

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

export interface ScanState {
  commit: string | null;
  modified: boolean;
}

export function readFindingsFiles(
  io: Io,
  root: string,
  state: ScanState,
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

      const current =
        document.commit === state.commit &&
        !(
          document.modified &&
          document.reported_at === undefined &&
          !state.modified
        );

      return current
        ? { name, status: "read", document, ...reported }
        : { name, status: "stale", document, ...reported };
    });
}

export function withoutAbsentModules(
  document: FindingsDocument,
  scans: Scan[],
): { document: FindingsDocument; dropped: number } {
  if (!document.modified || document.reported_at !== undefined) {
    return { document, dropped: 0 };
  }

  const present = new Set(
    scans.flatMap((scan) => scan.modules.map((m) => m.id)),
  );
  const findings = document.findings.filter((finding) =>
    finding.evidence.modules.every((id) => present.has(id)),
  );

  return {
    document: { ...document, findings },
    dropped: document.findings.length - findings.length,
  };
}
