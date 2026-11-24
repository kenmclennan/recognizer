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

export function readSource(
  io: Io,
  root: string,
  path: string,
): { text: string; hash: string } | null {
  try {
    const raw = io.readBytes(join(root, path));

    return {
      text: raw.toString("utf8"),
      hash: createHash("sha256").update(raw).digest("hex"),
    };
  } catch {
    return null;
  }
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

  const found = readSource(io, root, id);

  return found === null
    ? null
    : { files, source: found.text, hash: found.hash };
}
