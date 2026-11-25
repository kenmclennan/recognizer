import { describe, expect, it } from "vitest";
import { createEstimateAnswers } from "../../src/estimate-answers";
import type { EstimateAnswer, EstimateRequest } from "../../src/estimate-text";

const REQUEST: EstimateRequest = {
  intent: { describe: false, analysis: true, sense: [] },
  planWork: {},
  parts: [],
  work: {},
};

const answer = (lastRun: string): EstimateAnswer => ({
  lastRun,
  describeRateMs: null,
  parts: [],
});

describe("createEstimateAnswers", () => {
  it("answers nothing before the first reply and asks once per request and stamp", async () => {
    const asked: EstimateRequest[] = [];
    const answers = createEstimateAnswers(
      async (request) => {
        asked.push(request);

        return answer("one");
      },
      () => {},
    );

    expect(answers.answerFor(REQUEST, "a")).toBeNull();

    answers.ask(REQUEST, "a");
    answers.ask(REQUEST, "a");
    await Promise.resolve();
    await Promise.resolve();

    expect(asked).toHaveLength(1);
    expect(answers.answerFor(REQUEST, "a")?.lastRun).toBe("one");
  });

  it("keeps showing the last reply while a new stamp is answered, then switches", async () => {
    let turn = 0;
    const changes: number[] = [];
    const answers = createEstimateAnswers(
      async () => answer(`reply-${++turn}`),
      () => changes.push(turn),
    );

    answers.ask(REQUEST, "a");
    await Promise.resolve();
    await Promise.resolve();
    answers.ask(REQUEST, "b");

    expect(answers.answerFor(REQUEST, "b")?.lastRun).toBe("reply-1");

    await Promise.resolve();
    await Promise.resolve();

    expect(answers.answerFor(REQUEST, "b")?.lastRun).toBe("reply-2");
    expect(changes).toEqual([1, 2]);
  });
});
