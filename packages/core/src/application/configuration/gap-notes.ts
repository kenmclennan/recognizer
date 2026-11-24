import type {
  SurveyNote,
  SurveyRunner,
  SurveySuite,
} from "../../domain/configuration/setup-survey.js";
import { type LanguageRule, readsPath } from "../../domain/language-rule.js";
import { compareText } from "./internal/text-paths.js";

export function gapNotes(
  files: string[],
  rules: readonly LanguageRule[],
  runners: SurveyRunner[],
  suites: SurveySuite[],
  notes: SurveyNote[],
): SurveyNote[] {
  const counts = new Map<string, number>();
  const listed = new Set(files);

  for (const file of files) {
    const languages = new Set(
      rules
        .filter((rule) => readsPath(rule, file, (path) => listed.has(path)))
        .map((rule) => rule.name),
    );

    for (const language of languages) {
      counts.set(language, (counts.get(language) ?? 0) + 1);
    }
  }

  const [top] = [...counts].sort(
    ([a, x], [b, y]) => y - x || compareText(a, b),
  );

  if (top === undefined) {
    return [];
  }

  const [language, count] = top;
  const covered =
    runners.some((one) => one.language === language) ||
    suites.some((one) => one.language === language) ||
    notes.some((one) => one.language === language);

  return covered
    ? []
    : [
        {
          language,
          directory: ".",
          text: `${language} is the largest language here (${count} files) and no test runner was found for it, so a sensor that runs tests will cover only part of this repository`,
        },
      ];
}
