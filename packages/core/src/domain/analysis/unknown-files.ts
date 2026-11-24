import type { Repository } from "../repository.js";
import type { UnknownFiles } from "../unknown-files.js";
import type { LanguageBehaviour } from "./language-behaviour.js";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function unknownFilesOf(
  repository: Repository,
  behaviour: LanguageBehaviour,
): UnknownFiles | null {
  const unknown = repository.files.filter(
    (file) => !behaviour.publishes(file.language),
  );

  if (unknown.length === 0) {
    return null;
  }

  return {
    languages: [...new Set(unknown.map((file) => file.language))].sort(
      byCodeUnit,
    ),
    files: [...new Set(unknown.map((file) => file.path))].sort(byCodeUnit),
  };
}

export function narrowUnknownFiles(
  unknownFiles: UnknownFiles | null,
  repository: Repository,
  named: ReadonlySet<string>,
): UnknownFiles | null {
  if (unknownFiles === null) {
    return null;
  }

  const kept = new Set(unknownFiles.files.filter((path) => named.has(path)));

  if (kept.size === 0) {
    return null;
  }

  const files = [...kept].sort(byCodeUnit);
  const languages = [
    ...new Set(
      repository.files
        .filter((file) => kept.has(file.path))
        .map((file) => file.language),
    ),
  ].sort(byCodeUnit);

  return { languages, files };
}
