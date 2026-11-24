import type { Responsibilities } from "../../../domain/describing/responsibilities.js";
import {
  type LineStatus,
  lineStatus,
} from "../../../domain/describing/responsibility.js";
import type { Repository } from "../../../domain/repository.js";
import type { DescriberRef } from "../ports/describer-ref.js";

export interface Subject {
  id: string;
  hash: string | null;
  files: string[];
  source: string;
  status: LineStatus | { status: "unreadable" };
}

export type SourceReader = (
  path: string,
) => { text: string; hash: string } | null;

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

export function subjectFor(
  read: SourceReader,
  repository: Repository,
  id: string,
  responsibilities: Responsibilities,
  describer: DescriberRef,
): Subject {
  const files = sourceFiles(repository, id);
  const found = files.length === 0 ? null : read(id);

  if (found === null) {
    return {
      id,
      hash: null,
      files: [],
      source: "",
      status: { status: "unreadable" },
    };
  }

  return {
    id,
    hash: found.hash,
    files,
    source: found.text,
    status: lineStatus(
      responsibilities.get(id),
      found.hash,
      describer.command,
      describer.version,
    ),
  };
}
