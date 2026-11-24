import {
  type BuiltChanges,
  buildChanges,
  type SetupChoices,
} from "../../domain/configuration/setup-changes.js";
import type { Survey } from "../../domain/configuration/setup-survey.js";
import type { Repository } from "../../domain/repository.js";
import type { ConfigurationPorts } from "./internal/configuration-ports.js";
import { surveySetup } from "./survey-setup.js";

export interface BuildSetupChangesInput {
  root: string;
  choices: SetupChoices;
  scan?: Repository;
}

export async function buildSetupChanges(
  ports: ConfigurationPorts,
  { root, choices, scan }: BuildSetupChangesInput,
): Promise<{ survey: Survey; built: BuiltChanges }> {
  const survey = await surveySetup(ports, {
    root,
    ...(scan === undefined ? {} : { scan }),
  });

  return {
    survey,
    built: buildChanges(survey, choices),
  };
}
