import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Repository } from "@recognizer/core";
import type { Io } from "./cli.js";

export interface ModuleSource {
  files: string[];
  source: string;
  hash: string;
}

function sourceFiles(repository: Repository, id: string): string[] {
  if (!repository.hasFile(id)) {
    return [];
  }

  return repository.extractions.some(({ files }) =>
    files.some((file) => file.path === id),
  )
    ? [id]
    : [];
}

export function moduleSource(
  io: Io,
  root: string,
  repository: Repository,
  id: string,
): ModuleSource | null {
  const files = sourceFiles(repository, id);

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
