import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const packages = resolve(here, "../..");

const USER_TEXT = [
  "core/src/domain/configuration/published-keys.ts",
  "core/src/application/configuration/gap-notes.ts",
  "core/src/domain/configuration/thresholds-migration.ts",
  "core/src/domain/configuration/retired-keys.ts",
  "cli/src/commands.ts",
  "cli/src/skills.ts",
];

const OFFICIAL = [
  "C\\.R\\.A\\.P\\.",
  "recognizer-(scan|sense|describe)-(python|typescript|kotlin|csharp|rust|claude|crap|mutation|structure)",
  "(plugin add|sensors check|help sensors) (crap|mutation|claude)",
  "--add-section sensors\\.(crap|mutation)",
];

describe("user text names no official plugin", () => {
  it.each(USER_TEXT)("%s", (file) => {
    const text = readFileSync(join(packages, file), "utf8");
    const hits = text
      .split("\n")
      .filter((line) => new RegExp(OFFICIAL.join("|")).test(line));

    expect(hits).toEqual([]);
  });
});
