import {
  SURVEY_VERSION,
  type Survey,
} from "../../domain/configuration/setup-survey.js";
import {
  assembleRunners,
  type PluginAnswer,
  type PublishedValues,
} from "../../domain/configuration/survey-answer.js";
import { InvalidRequest } from "../../domain/invalid-request.js";
import { joinPath } from "../../domain/path.js";
import type { PolicyRule } from "../../domain/policy-rule.js";
import type { Repository } from "../../domain/repository.js";
import { gapNotes } from "./gap-notes.js";
import type { ConfigurationPorts } from "./internal/configuration-ports.js";
import {
  checksOf,
  filesOf,
  filterListing,
  fixesOf,
  markLanguages,
  policyOf,
  suitesOf,
} from "./internal/survey-facts.js";

export interface SurveyRequestInput {
  root: string;
  scan?: Repository;
}

function readPolicy(
  ports: ConfigurationPorts,
  root: string,
): readonly PolicyRule[] | null {
  try {
    return ports.policy.rules(root);
  } catch {
    return null;
  }
}

function publishedValues(
  ports: ConfigurationPorts,
  answers: PluginAnswer[],
): PublishedValues | null {
  const answered = answers.some(
    (one) => "answer" in one && one.answer.runners.length > 0,
  );

  if (!answered) {
    return null;
  }

  return ports.keyOwners.schemas().schema.keys;
}

export async function surveySetup(
  ports: ConfigurationPorts,
  { root, scan }: SurveyRequestInput,
): Promise<Survey> {
  if (ports.files.children(root) === null) {
    throw new InvalidRequest([`repository is not a directory: ${root}`]);
  }

  const files = filterListing(ports.files.list(root));
  const { present: configured, document } = ports.config.setupDocument(root);
  const scans = scan ?? ports.reads.cachedScans(root);
  const suites = suitesOf(document, files, configured);
  const answers = await ports.plugins.answers({
    root,
    files,
    suites: suites.map((suite) => ({
      language: suite.language,
      directory: suite.directory,
    })),
  });
  const assembled = assembleRunners(
    answers,
    root,
    new Set(suites.map((suite) => suite.name)),
    publishedValues(ports, answers),
  );
  const checks = checksOf(document, configured, {
    sensors: ports.reads.sensors(),
    describers: ports.reads.describers(),
    keys: ports.keys.entries(),
  });
  const policyPresent = ports.files.exists(
    joinPath(root, ".recognizer", "policy.yaml"),
  );

  return {
    survey_version: SURVEY_VERSION,
    version: ports.version,
    repository: root,
    configured,
    files:
      scans === null
        ? null
        : markLanguages(filesOf(scans), document, suites, configured),
    checks,
    runners: assembled.runners,
    notes: [
      ...assembled.notes,
      ...gapNotes(
        files,
        ports.reads.languageRules(),
        assembled.runners,
        suites,
        assembled.notes,
      ),
    ],
    tools: assembled.tools,
    fixes: fixesOf(ports.reads.diagnose(root), checks),
    suites,
    policy: policyOf(policyPresent, readPolicy(ports, root), scans),
  };
}
