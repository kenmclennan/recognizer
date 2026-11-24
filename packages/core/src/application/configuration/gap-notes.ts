import type {
  SurveyNote,
  SurveyRunner,
  SurveySuite,
} from "../../domain/configuration/setup-survey.js";
import { SOURCE_EXTENSIONS } from "./internal/survey-facts.js";
import { compareText, extensionOf } from "./internal/text-paths.js";

export function gapNotes(
  files: string[],
  runners: SurveyRunner[],
  suites: SurveySuite[],
  notes: SurveyNote[],
): SurveyNote[] {
  const counts = new Map<string, number>();

  for (const file of files) {
    const language = SOURCE_EXTENSIONS[extensionOf(file)];

    if (language !== undefined) {
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
          text: `${language} is the largest language here (${count} files) and no test runner was found for it, so C.R.A.P. and Mutation will cover only part of this repository`,
        },
      ];
}
