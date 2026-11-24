import type { Manifest } from "./manifest.js";

export function grammarsWithoutVocabulary(manifest: Manifest): string[] {
  const missing: string[] = [];

  for (const language of manifest.languages ?? []) {
    const grammars = (language as { grammars?: unknown }).grammars;

    if (!Array.isArray(grammars)) {
      continue;
    }

    for (const grammar of grammars) {
      const entry = grammar as { name?: unknown; vocabulary?: unknown };

      if (entry.vocabulary === undefined || entry.vocabulary === null) {
        missing.push(String(entry.name));
      }
    }
  }

  return missing;
}

export function grammarVocabularyMessage(
  program: string,
  missing: readonly string[],
): string {
  return `${program} publishes no vocabulary for the ${missing.join(", ")} grammar, so structural analysis reads comments and literals into fingerprints and treats no function shape as trivial`;
}
