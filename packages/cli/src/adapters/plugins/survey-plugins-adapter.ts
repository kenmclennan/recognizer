import {
  joinPath,
  type LanguageRule,
  type PluginAnswer,
  readsDirectoriesOf,
  type SurveyAnswer,
  type SurveyPlugins,
  type SurveyRequest,
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import validate from "../../generated/survey-answer-validator.js";
import { installedScanners } from "./installed-scanners.js";

export const SURVEY_ANSWER_TIMEOUT_MS = 60_000;

function languageOf(manifest: { languages?: unknown[] }): string {
  const first = manifest.languages?.[0] as { name?: unknown } | undefined;

  return typeof first?.name === "string" ? first.name : "";
}

function languageRuleOf(manifest: {
  languages?: unknown[];
}): LanguageRule | null {
  const first = manifest.languages?.[0];

  return first === undefined ? null : (first as LanguageRule);
}

function parseAnswer(text: string): SurveyAnswer | string {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return "the answer is not JSON";
  }

  if (!validate(value)) {
    return "the answer does not match the survey answer schema";
  }

  return value as SurveyAnswer;
}

export class SurveyPluginsAdapter implements SurveyPlugins {
  constructor(
    private readonly io: Io,
    private readonly timeoutMs: number = SURVEY_ANSWER_TIMEOUT_MS,
  ) {}

  async answers(request: SurveyRequest): Promise<PluginAnswer[]> {
    const asked = installedScanners(this.io).plugins.filter(
      (plugin) => plugin.manifest.setup_survey !== undefined,
    );

    if (asked.length === 0) {
      return [];
    }

    const directory = this.io.makeTempDir();

    try {
      const listed = new Set(request.files);

      return await Promise.all(
        asked.map(async (plugin): Promise<PluginAnswer> => {
          const identity = {
            plugin: plugin.name,
            order: plugin.manifest.setup_survey?.order ?? 0,
            language: languageOf(plugin.manifest),
          };
          const rule = languageRuleOf(plugin.manifest);
          const file = joinPath(
            directory,
            `survey-request-${plugin.name}.json`,
          );
          const files =
            rule === null
              ? request.files
              : request.files.filter((path) =>
                  readsDirectoriesOf(rule, path, (one) => listed.has(one)),
                );

          this.io.writeFile(file, JSON.stringify({ ...request, files }));

          const run = await this.io.runAsync(plugin.command, ["survey", file], {
            timeoutMs: this.timeoutMs,
          }).result;

          if (!run.started) {
            return { ...identity, failure: "it could not be started" };
          }

          if (run.timedOut === true) {
            return { ...identity, failure: "it timed out" };
          }

          if (run.status !== 0) {
            return {
              ...identity,
              failure: `it exited ${run.status ?? "by signal"}`,
            };
          }

          const parsed = parseAnswer(run.stdout);

          return typeof parsed === "string"
            ? { ...identity, failure: parsed }
            : { ...identity, answer: parsed };
        }),
      );
    } finally {
      this.io.removeDir(directory);
    }
  }
}
