import type {
  PluginAnswer,
  SurveyPlugins,
  SurveyRequest,
} from "../../src/index.js";

export class FakeSurveyPlugins implements SurveyPlugins {
  seeded: PluginAnswer[] = [];
  readonly requests: SurveyRequest[] = [];
  gate: Promise<void> | null = null;

  async answers(request: SurveyRequest): Promise<PluginAnswer[]> {
    this.requests.push(request);

    if (this.gate !== null) {
      await this.gate;
    }

    return [...this.seeded].sort((a, b) => a.order - b.order);
  }
}
