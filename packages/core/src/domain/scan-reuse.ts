import type { Repository } from "./repository.js";

export function extractionsReusable(
  extractions: Repository["extractions"],
  commit: string,
  hashOf: (path: string) => string | null,
): boolean {
  return extractions.every(
    (extraction) =>
      extraction.commit === commit &&
      extraction.modified === false &&
      extraction.files.every((file) => hashOf(file.path) === file.hash),
  );
}
