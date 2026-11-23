import type { Repository } from "@recognizer/core";

export function scansCommit(repository: Repository): {
  commit: string | null;
  modified: boolean;
} {
  const { extractions } = repository;

  return {
    commit: extractions[0]?.commit ?? null,
    modified: extractions.some((extraction) => extraction.modified !== false),
  };
}
