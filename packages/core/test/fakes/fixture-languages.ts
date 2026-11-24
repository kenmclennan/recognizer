import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { LanguageBehaviour, type LanguageRule } from "../../src/index.js";

function fixturePath(): string {
  let directory = import.meta.dirname;

  while (!existsSync(join(directory, "fixtures/plugins/languages.json"))) {
    directory = dirname(directory);
  }

  return join(directory, "fixtures/plugins/languages.json");
}

export const FIXTURE_LANGUAGES: LanguageRule[] = JSON.parse(
  readFileSync(fixturePath(), "utf8"),
) as LanguageRule[];

export const BEHAVIOUR = new LanguageBehaviour(FIXTURE_LANGUAGES);
