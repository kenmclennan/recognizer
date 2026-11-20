import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Io } from "./cli.js";
import type { RecordedScan, Scan } from "./scan.js";

export interface ModuleSource {
  files: string[];
  source: string;
  hash: string;
}

function sourceFiles(scans: Scan[], id: string): string[] {
  const listing = scans.find((scan) =>
    scan.modules.some((module) => module.id === id),
  ) as RecordedScan | undefined;

  return (listing?.files ?? []).some((file) => file.path === id) ? [id] : [];
}

export function moduleSource(
  io: Io,
  root: string,
  scans: Scan[],
  id: string,
): ModuleSource | null {
  const files = sourceFiles(scans, id);

  if (files.length === 0) {
    return null;
  }

  try {
    const raw = io.readBytes(join(root, id));
    const source = raw.toString("utf8");
    const hash = createHash("sha256").update(raw).digest("hex");

    return { files, source, hash };
  } catch {
    return null;
  }
}
