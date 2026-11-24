import type {
  PluginAnswer,
  SurveyRequest,
} from "../../../domain/configuration/survey-answer.js";

export interface SurveyPlugins {
  answers(request: SurveyRequest): Promise<PluginAnswer[]>;
}
