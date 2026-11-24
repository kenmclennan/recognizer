import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LanguageBehaviour, type LanguageRule } from "@recognizer/core";
import { REPO } from "./helpers.js";

export const FIXTURE_LANGUAGES: LanguageRule[] = JSON.parse(
  readFileSync(join(REPO, "fixtures/plugins/languages.json"), "utf8"),
) as LanguageRule[];

export const BEHAVIOUR = new LanguageBehaviour(FIXTURE_LANGUAGES);
