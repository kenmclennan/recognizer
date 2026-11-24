import type {
  Assistant,
  AssistantAnswer,
  AssistantRequest,
  AssistantResult,
  RunningAsk,
} from "../../src/index.js";

export const PROPOSAL: AssistantAnswer = {
  structured: { entries: [] },
  costUsd: 0.25,
  durationMs: 1200,
  isError: false,
  subtype: "success",
  text: null,
  denials: 0,
};

export class FakeAssistant implements Assistant {
  next: AssistantResult = {
    answer: PROPOSAL,
    exit: 0,
    stderr: "",
    started: true,
  };
  hold = false;
  lines: string[] = [];
  readonly asked: AssistantRequest[] = [];
  killed = 0;

  ask(request: AssistantRequest): RunningAsk {
    this.asked.push(request);

    for (const line of this.lines) {
      request.onLine(line);
    }

    if (!this.hold) {
      return { result: Promise.resolve(this.next), kill: () => {} };
    }

    let settle: (result: AssistantResult) => void = () => {};
    const result = new Promise<AssistantResult>((resolve) => {
      settle = resolve;
    });

    return {
      result,
      kill: () => {
        this.killed += 1;
        settle({ answer: null, exit: null, stderr: "", started: true });
      },
    };
  }
}
