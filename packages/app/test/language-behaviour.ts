import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LanguageBehaviour, type LanguageRule } from "@recognizer/core";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const FIXTURE_LANGUAGES: LanguageRule[] = JSON.parse(
  readFileSync(join(REPO, "fixtures/plugins/languages.json"), "utf8"),
) as LanguageRule[];

export const BEHAVIOUR = new LanguageBehaviour(FIXTURE_LANGUAGES);
