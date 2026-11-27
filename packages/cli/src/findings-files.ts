import { basename, dirname, join } from "node:path";
import {
  type AccumulatedOverlay,
  type CommitResults,
  InvalidEntity,
  type RunScope,
  type SensorFindings,
  type SettleEnding,
  type StoredFindings,
  type StoredOverlay,
} from "@recognizer/core";
import {
  overlayDocumentOf,
  readSensorFindings,
  sensorFindingsDocument,
} from "./adapters/filesystem/findings-translator.js";
import type { Io } from "./cli.js";

export const COMMIT_RETENTION = 20;

const COMMIT_ID = /^[0-9a-f]{40}$/;

export function commitsFolder(root: string): string {
  return join(root, ".recognizer", "cache", "commits");
}

function base(root: string, scope: RunScope): string {
  if (scope.kind === "working-tree") {
    return join(root, ".recognizer", "cache");
  }

  if (!COMMIT_ID.test(scope.commit)) {
    throw new InvalidEntity(
      "RunScope",
      "a commit is a full lowercase 40-character hexadecimal id",
      scope.commit,
    );
  }

  return join(commitsFolder(root), scope.commit);
}

export function findingsFolder(
  root: string,
  scope: RunScope = { kind: "working-tree" },
): string {
  return join(base(root, scope), "findings");
}

export function findingsFile(
  root: string,
  name: string,
  scope: RunScope = { kind: "working-tree" },
): string {
  return join(findingsFolder(root, scope), `${name}.json`);
}

export function overlayFolder(
  root: string,
  scope: RunScope = { kind: "working-tree" },
): string {
  return join(base(root, scope), "overlays");
}

export function overlayFile(
  root: string,
  name: string,
  scope: RunScope = { kind: "working-tree" },
): string {
  return join(overlayFolder(root, scope), `${name}.json`);
}

export function overlayOfFindings(findings: string): string {
  return join(dirname(dirname(findings)), "overlays", basename(findings));
}

export function readStoredOverlays(
  io: Io,
  root: string,
  scope: RunScope = { kind: "working-tree" },
): StoredOverlay[] {
  let names: string[];

  try {
    names = io
      .readDir(overlayFolder(root, scope))
      .filter((entry) => entry.kind === "file" && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -".json".length))
      .sort();
  } catch {
    return [];
  }

  return names.map((name): StoredOverlay => {
    try {
      return {
        name,
        status: "read",
        text: io.readFile(overlayFile(root, name, scope)),
      };
    } catch (error) {
      return { name, status: "invalid", reason: (error as Error).message };
    }
  });
}

export function writeFindings(
  io: Io,
  root: string,
  findings: SensorFindings,
): void {
  const target = findingsFile(root, findings.sensor.name);
  const temp = `${target}.tmp`;

  try {
    io.writeFile(
      temp,
      `${JSON.stringify(sensorFindingsDocument(findings), null, 2)}\n`,
    );
    io.rename(temp, target);
  } catch (error) {
    io.remove(temp);

    throw error;
  }
}

export function readStoredFindings(
  io: Io,
  root: string,
  scope: RunScope = { kind: "working-tree" },
): StoredFindings[] {
  let names: string[];

  try {
    names = io
      .readDir(findingsFolder(root, scope))
      .filter((entry) => entry.kind === "file" && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -".json".length))
      .sort();
  } catch {
    return [];
  }

  return names.map((name): StoredFindings => {
    try {
      return {
        name,
        status: "read",
        document: readSensorFindings(
          JSON.parse(io.readFile(findingsFile(root, name, scope))),
          scope.kind === "commit" ? { name, commit: scope.commit } : { name },
        ),
      };
    } catch (error) {
      return { name, status: "invalid", reason: (error as Error).message };
    }
  });
}

export function stagePair(
  io: Io,
  root: string,
  scope: RunScope,
  document: SensorFindings,
  overlay: AccumulatedOverlay | null,
): void {
  const name = document.sensor.name;
  const findings = `${findingsFile(root, name, scope)}.tmp`;
  const overlays = `${overlayFile(root, name, scope)}.tmp`;
  const text = `${JSON.stringify(sensorFindingsDocument(document), null, 2)}\n`;

  if (scope.kind === "commit" && document.modified) {
    throw new InvalidEntity(
      "SensorFindings",
      "a commit document is never modified",
      document.modified,
    );
  }

  try {
    io.writeFile(findings, text);

    if (overlay === null) {
      io.remove(overlays);
    } else {
      io.writeFile(
        overlays,
        `${JSON.stringify(overlayDocumentOf(document, overlay), null, 2)}\n`,
      );
    }
  } catch (error) {
    io.remove(findings);
    io.remove(overlays);

    throw error;
  }
}

type Counted = {
  counts?: { measured?: number };
  stopped?: { measured?: number };
  partial?: { measured?: number };
};

function measuredOf(document: Counted): number | null {
  const measured =
    document.counts?.measured ??
    document.stopped?.measured ??
    document.partial?.measured;

  return typeof measured === "number" ? measured : null;
}

function protects(io: Io, output: string, staged: Counted): boolean {
  if (!io.exists(output)) {
    return false;
  }

  try {
    const existing = JSON.parse(io.readFile(output)) as Counted;
    const kept = measuredOf(existing);
    const incoming = measuredOf(staged);

    return kept !== null && incoming !== null && incoming < kept;
  } catch {
    return false;
  }
}

function isCommitFolder(name: string): boolean {
  return COMMIT_ID.test(name);
}

export function readCommits(io: Io, root: string): CommitResults[] {
  let names: string[];

  try {
    names = io
      .readDir(commitsFolder(root))
      .filter(
        (entry) => entry.kind === "directory" && isCommitFolder(entry.name),
      )
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }

  return names.map((commit) => {
    const scope: RunScope = { kind: "commit", commit };

    return {
      commit,
      stored: readStoredFindings(io, root, scope),
      overlays: readStoredOverlays(io, root, scope),
    };
  });
}

export function removeCommit(io: Io, root: string, commit: string): void {
  base(root, { kind: "commit", commit });
  io.removeDir(join(commitsFolder(root), commit));
}

function prune(io: Io, root: string): void {
  let folders: { name: string; at: number }[];

  try {
    folders = io
      .readDir(commitsFolder(root))
      .filter(
        (entry) => entry.kind === "directory" && isCommitFolder(entry.name),
      )
      .map((entry) => ({
        name: entry.name,
        at: io.modified?.(join(commitsFolder(root), entry.name)) ?? 0,
      }));
  } catch {
    return;
  }

  folders.sort((a, b) =>
    a.at !== b.at ? b.at - a.at : a.name < b.name ? -1 : 1,
  );

  for (const { name } of folders.slice(COMMIT_RETENTION)) {
    removeCommit(io, root, name);
  }
}

export function settlePair(
  io: Io,
  root: string,
  scope: RunScope,
  name: string,
  ending: SettleEnding,
): "replaced" | "kept" {
  const findings = findingsFile(root, name, scope);
  const overlays = overlayFile(root, name, scope);
  const stagedFindings = `${findings}.tmp`;
  const stagedOverlay = `${overlays}.tmp`;

  if (!io.exists(stagedFindings)) {
    io.remove(stagedOverlay);

    return "kept";
  }

  if (ending === "checkpoint") {
    let staged: Counted = {};

    try {
      staged = JSON.parse(io.readFile(stagedFindings)) as Counted;
    } catch {}

    if (protects(io, findings, staged)) {
      io.remove(stagedFindings);
      io.remove(stagedOverlay);

      return "kept";
    }
  }

  io.rename(stagedFindings, findings);

  if (io.exists(stagedOverlay)) {
    io.rename(stagedOverlay, overlays);
  }

  if (scope.kind === "commit") {
    prune(io, root);
  }

  return "replaced";
}
