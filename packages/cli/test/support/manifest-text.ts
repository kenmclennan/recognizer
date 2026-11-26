import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../helpers.js";

const LANGUAGE_RULES = JSON.parse(
  readFileSync(join(REPO, "fixtures/plugins/languages.json"), "utf8"),
) as { name: string }[];

export function scannerManifestText(
  name: string,
  languages: string[] = [name],
  protocol = 4,
): string {
  const manifest = JSON.parse(
    readFileSync(
      join(REPO, "schema/manifest-examples/valid/scanner.json"),
      "utf8",
    ),
  );

  return `${JSON.stringify({
    ...manifest,
    name,
    protocol,
    languages: languages.map(
      (language) =>
        LANGUAGE_RULES.find((rule) => rule.name === language) ?? {
          name: language,
          extensions: [`.${language}`],
          files: [],
          skip: {
            directory_names: [],
            directory_prefixes: [],
            directory_suffixes: [],
            directory_markers: [],
            file_globs: [],
          },
        },
    ),
  })}\n`;
}

export function describerManifestText(promptVersion: string): string {
  const manifest = JSON.parse(
    readFileSync(
      join(REPO, "schema/manifest-examples/valid/describer.json"),
      "utf8",
    ),
  );

  return `${JSON.stringify({ ...manifest, prompt_version: promptVersion })}\n`;
}
